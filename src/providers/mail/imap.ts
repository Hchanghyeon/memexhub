import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import { nowIn } from "../../core/time.js";
import { ImapClient, ImapError } from "./imap-client.js";
import { decodeMUtf7, encodeMUtf7, headerText, messageText, splitPart } from "./mime.js";
import type { Mail, MailProvider, MailSummary } from "./types.js";

const PRESETS: Record<string, { host?: string; digest: string }> = {
  kakao: { host: "imap.kakao.com", digest: "Inbox:received:body, Sent Messages:sent:body, 청구서:bills, 쇼핑:shopping, 소셜:social, 프로모션:promotions" },
  naver: { host: "imap.naver.com", digest: "INBOX:received:body, Sent Messages:sent:body" },
  gmail: { host: "imap.gmail.com", digest: "INBOX:received:body, [Gmail]/Sent Mail:sent:body" },
  outlook: { host: "outlook.office365.com", digest: "INBOX:received:body, Sent:sent:body" },
  custom: { digest: "INBOX:received:body" },
};

const Config = z.object({
  preset: z.enum(["kakao", "naver", "gmail", "outlook", "custom"]).default("custom").describe("Mail service"),
  host: z.string().optional().describe("IMAP host (only for custom)"),
  port: z.number().int().default(993).describe("Port"),
  username: z.string().min(1).describe("Username / email"),
  digestFolders: z.string().optional().describe("Daily digest folders: name:label[:body], comma separated (empty = preset)"),
  allowPrivateNetwork: z.boolean().default(false).describe("Server is on my private network (allows plain IMAP)"),
  tls: z.boolean().default(true).describe("Use TLS"),
});
type Config = z.infer<typeof Config>;

const MAX_SCAN = 400;
const MAX_BODY = 8000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const imapDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return `${d}-${MONTHS[m - 1]}-${y}`;
};
const addDay = (ymd: string) => new Date(Date.parse(ymd + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);

export class ImapMail implements MailProvider {
  constructor(private c: Config, private password: string, private tz: string, private hostGuard: () => Promise<void>) {}

  private host() {
    return this.c.host || PRESETS[this.c.preset]!.host || "";
  }

  private async session<T>(fn: (cl: ImapClient) => Promise<T>): Promise<T> {
    await this.hostGuard();
    if (!this.c.tls && !this.c.allowPrivateNetwork) throw new ImapError("plain IMAP is only allowed on a private network");
    const cl = await ImapClient.open({ host: this.host(), port: this.c.port, tls: this.c.tls });
    try {
      await cl.login(this.c.username, this.password);
      return await fn(cl);
    } finally {
      await cl.logout();
    }
  }

  private async examine(cl: ImapClient, folder: string) {
    const name = folder.toUpperCase() === "INBOX" ? "INBOX" : encodeMUtf7(folder);
    await cl.cmd([`EXAMINE ${ImapClient.quote(name)}`]); // read-only open
  }

  private fmtDate(v: string) {
    const ms = Date.parse(v);
    if (isNaN(ms)) return "";
    const p = nowIn(this.tz, new Date(ms));
    const z = (n: number) => String(n).padStart(2, "0");
    return `${p.y}-${z(p.m)}-${z(p.d)} ${z(p.h)}:${z(p.mi)}`;
  }

  async folders(): Promise<string[]> {
    return this.session(async (cl) => {
      const rows = await cl.cmd([`LIST "" "*"`]);
      return rows
        .filter((r) => /^\* LIST /i.test(r.line))
        .map((r) => {
          const lit = r.line.match(/\x00(\d+)\x00\s*$/);
          if (lit) return decodeMUtf7(new TextDecoder().decode(r.literals[Number(lit[1])]));
          const m = r.line.match(/"((?:[^"\\]|\\.)*)"\s*$|(\S+)\s*$/);
          return decodeMUtf7((m?.[1] ?? m?.[2] ?? "").replace(/\\(.)/g, "$1"));
        })
        .filter(Boolean);
    });
  }

  async search(q: { folder: string; since: string; until?: string; query?: string; from?: string; limit: number }): Promise<MailSummary[]> {
    return this.session(async (cl) => {
      await this.examine(cl, q.folder);
      const crit = `SINCE ${imapDate(q.since)}` + (q.until ? ` BEFORE ${imapDate(addDay(q.until))}` : "");
      const res = await cl.cmd([`UID SEARCH ${crit}`]);
      const uids = res.flatMap((r) => (/^\* SEARCH/i.test(r.line) ? r.line.replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter((x) => /^\d+$/.test(x)) : [])).slice(-MAX_SCAN);
      if (!uids.length) return [];
      const rows = await cl.cmd([`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`]);
      const out: MailSummary[] = [];
      for (const r of rows) {
        const uid = r.line.match(/UID (\d+)/)?.[1];
        const lit = r.literals[0];
        if (!uid || !lit) continue;
        const h = splitPart(lit).headers;
        const item = { uid, folder: q.folder, from: headerText(h.get("from")), subject: headerText(h.get("subject")), date: this.fmtDate(h.get("date") ?? "") };
        const hay = `${item.from} ${item.subject}`.toLowerCase();
        if (q.query && !hay.includes(q.query.toLowerCase())) continue;
        if (q.from && !item.from.toLowerCase().includes(q.from.toLowerCase())) continue;
        out.push(item);
      }
      return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, Math.max(1, Math.min(q.limit, 50)));
    });
  }

  async read(folder: string, uid: string): Promise<Mail> {
    if (!/^\d{1,10}$/.test(uid)) throw new ImapError("uid must be a number from mail_search");
    return this.session(async (cl) => {
      await this.examine(cl, folder);
      const rows = await cl.cmd([`UID FETCH ${uid} (UID BODY.PEEK[]<0.3000000>)`]); // PEEK: \Seen is not set
      const lit = rows.find((r) => r.literals.length)?.literals[0];
      if (!lit) throw new ImapError(`mail not found: uid ${uid}`);
      const h = splitPart(lit).headers;
      const { text, attachments } = messageText(lit);
      return {
        uid, folder,
        from: headerText(h.get("from")), to: headerText(h.get("to")), subject: headerText(h.get("subject")), date: this.fmtDate(h.get("date") ?? ""),
        text: text.slice(0, MAX_BODY), truncated: text.length > MAX_BODY, attachments,
      };
    });
  }

  digestFolders(): [string, string, boolean][] {
    const spec = this.c.digestFolders || PRESETS[this.c.preset]!.digest;
    return spec.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const [name, label, body] = x.split(":");
      return [name!.trim(), (label ?? name)!.trim(), body?.trim() === "body"] as [string, string, boolean];
    });
  }
}

export const imapProvider = defineProvider({
  kind: "mail",
  id: "imap",
  title: T("IMAP mail (Kakao, Naver, Gmail, Outlook …): read-only", "IMAP 메일 (카카오·네이버·Gmail·Outlook …): 읽기 전용"),
  config: Config,
  secrets: z.object({ password: z.string().min(1).describe("Password or app password") }),
  runtimes: ["node"],
  create: ({ config, secrets, platform, timezone }) => {
    const host = config.host || PRESETS[config.preset]!.host || "";
    if (!host) throw new ImapError("host is required for a custom server");
    const guard = async () => {
      if (!config.allowPrivateNetwork && (await platform.isPrivateHost?.(host))) throw new ImapError("private network address not allowed");
    };
    return new ImapMail(config, secrets.password, timezone, guard);
  },
  test: async (m: any) => {
    await (m as MailProvider).folders();
  },
});

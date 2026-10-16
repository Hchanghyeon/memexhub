import type { Cursors } from "../../core/cursors.js";
import type { Inbox } from "../../core/inbox.js";
import { zonedIso, nowIn } from "../../core/time.js";
import type { MailProvider } from "../../providers/mail/types.js";
import type { Ledger } from "./record.js";
import type { MessageReader } from "./messages/reader.js";
import type { PendingMessage } from "./inbox-tools.js";

export interface MailSyncDeps {
  sources: () => { connection: string; folder: string }[];
  provider: (connection: string) => Promise<MailProvider | undefined>;
  reader: MessageReader;
  ledger: Ledger;
  inbox: Inbox;
  cursors: Cursors;
  tz: () => string;
  now: () => Date;
}

interface State {
  seen: string[]; // UIDs already read (per folder; capped)
}

const SEEN_MAX = 2000;
const day = (d: Date, tz: string) => {
  const n = nowIn(tz, d);
  return `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
};
/** "YYYY-MM-DD HH:MM" (provider time zone) → ISO with offset. */
const mailTime = (s: string, tz: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? zonedIso(tz, +m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!) : "";
};

const AD = /^\s*[\[(（]\s*(광고|AD)\s*[\])）]/i;
const PAYMENT_WORDS = /결제|승인|영수증|주문|구매|청구|납부|이용\s*내역|입금|출금|receipt|payment|order|invoice|charged|paid|purchase|billing/i;
const BULK = /수신\s*거부|구독\s*취소|unsubscribe/i;

/**
 * Whether an unrecognised mail with an amount is worth a person's look. Advertising (subject marked
 * "(광고)", required by Korean law) never is. Otherwise the subject must say it is about a payment, or the body
 * must, unless the mail is bulk mail (has an unsubscribe line) — newsletters mention prices all the time.
 */
export function looksLikePayment(subject: string | undefined, text: string): boolean {
  const subj = subject ?? "";
  if (AD.test(subj)) return false;
  if (PAYMENT_WORDS.test(subj)) return true;
  const body = text.slice(0, 4000);
  return PAYMENT_WORDS.test(body) && !BULK.test(text);
}

/**
 * Receipt mails → messages → recipes. Only mails a recipe recognises are recorded; anything else that
 * looks like a payment goes to the inbox (the generic parser is not trusted on mail; see looksLikePayment).
 * Each mail is read once.
 */
export async function syncReceiptMails(d: MailSyncDeps, opts: { since?: string; until?: string } = {}) {
  const tz = d.tz();
  const counts = { read: 0, recorded: 0, attached: 0, pending: 0, ignored: 0, skipped: 0 };
  const problems: string[] = [];
  for (const src of d.sources()) {
    const mp = await d.provider(src.connection).catch(() => undefined);
    if (!mp) {
      problems.push(`${src.connection}: mail account not connected`);
      continue;
    }
    const key = `ledger.mail:${src.connection}:${src.folder}`;
    const state = (await d.cursors.get<State>(key)) ?? { seen: [] };
    const seen = new Set(state.seen);
    const since = opts.since ?? day(new Date(d.now().getTime() - 2 * 86_400_000), tz);
    let rows;
    try {
      rows = await mp.search({ folder: src.folder, since, until: opts.until, limit: 100 });
    } catch (e) {
      problems.push(`${src.connection}/${src.folder}: ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    for (const row of rows.sort((a, b) => Number(a.uid) - Number(b.uid))) {
      if (seen.has(row.uid)) continue;
      try {
        const mail = await mp.read(src.folder, row.uid);
        counts.read++;
        const m = { channel: "mail" as const, from: mail.from, subject: mail.subject, text: mail.text };
        const r = await d.reader.read(m);
        if (r.kind === "ignore") counts.ignored++;
        else if (r.step === "recipe" && r.confident && r.payment) {
          const input = { ...r.payment, time: r.payment.time || mailTime(mail.date, tz), source: "mail" };
          const res = r.kind === "item" ? await d.ledger.attachOrRecord(input) : await d.ledger.record(input);
          if (res.kind === "item") counts.attached++;
          else counts.recorded++;
        } else if (r.payment?.amount && (r.step === "recipe" || looksLikePayment(mail.subject, mail.text))) {
          const data: PendingMessage = { message: { ...m, time: mailTime(mail.date, tz) }, guess: r.payment, step: r.step };
          await d.inbox.add("ledger", "mail", r.step === "recipe" ? `recipe ${r.recipeId}: ${r.reason ?? "incomplete"}` : "no recipe for this mail", data);
          counts.pending++;
        } else counts.skipped++;
        seen.add(row.uid);
      } catch (e) {
        problems.push(`${src.connection}/${src.folder} #${row.uid}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    await d.cursors.set(key, { seen: [...seen].slice(-SEEN_MAX) } satisfies State);
  }
  return { ...counts, problems };
}

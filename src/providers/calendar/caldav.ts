import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import { addDays, dayBounds } from "../../core/time.js";
import { parseIcal } from "./ical.js";
import type { CalendarEvent, CalendarInfo, CalendarProvider } from "./types.js";

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i"))?.[1]?.trim();
const responses = (xml: string) => [...xml.matchAll(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi)].map((m) => m[0]);
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#13;/g, "\r").replace(/&amp;/g, "&");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * CalDAV (RFC 4791), read-only: principal → calendar home → calendars → `calendar-query` with server-side
 * expansion of recurring events. Works with iCloud, Naver, Synology Calendar, Nextcloud, Fastmail, Radicale …
 */
export class CalDav implements CalendarProvider {
  private cache?: { at: number; list: (CalendarInfo & { href: string })[] };
  constructor(
    private o: { url: string; username: string; password: string; only: string[]; timezone: string },
    private f: typeof fetch,
    private now: () => number = () => Date.now(),
  ) {}

  /** `at` is an absolute URL; hrefs in answers are resolved against the URL that answered (iCloud moves hosts). */
  private async dav(method: string, at: string, depth: "0" | "1", body: string) {
    const basic = btoa(String.fromCharCode(...new TextEncoder().encode(`${this.o.username}:${this.o.password}`)));
    const r = await this.f(new URL(at), {
      method,
      headers: { authorization: `Basic ${basic}`, depth, "content-type": "application/xml; charset=utf-8" },
      body,
    });
    if (r.status === 401 || r.status === 403) throw new Error("CalDAV sign-in refused: check the username and (app) password");
    if (r.status !== 207 && !r.ok) throw new Error(`CalDAV ${method} ${r.status}`);
    return r.text();
  }
  private async href(at: string, prop: string, ns: string) {
    const xml = await this.dav("PROPFIND", at, "0", `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="${ns}"><d:prop><${ns === "DAV:" ? "d" : "c"}:${prop}/></d:prop></d:propfind>`);
    const inner = tag(xml, prop);
    const href = inner ? tag(inner, "href") : undefined;
    return href ? new URL(decode(href), at).href : undefined;
  }

  async calendars(): Promise<CalendarInfo[]> {
    return (await this.list()).map(({ id, name }) => ({ id, name }));
  }
  private async list() {
    if (this.cache && this.now() - this.cache.at < 3600_000) return this.cache.list;
    const principal = (await this.href(this.o.url, "current-user-principal", "DAV:")) ?? this.o.url;
    const home = (await this.href(principal, "calendar-home-set", "urn:ietf:params:xml:ns:caldav")) ?? principal;
    const xml = await this.dav("PROPFIND", home, "1", `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>`);
    const list: (CalendarInfo & { href: string })[] = [];
    for (const r of responses(xml)) {
      const type = tag(r, "resourcetype") ?? "";
      if (!/<(?:[\w-]+:)?calendar\b/i.test(type)) continue;
      const comps = tag(r, "supported-calendar-component-set");
      if (comps && !/name="VEVENT"/i.test(comps)) continue;
      const path = decode(tag(r, "href") ?? "");
      if (!path) continue;
      const href = new URL(path, home).href;
      const name = decode(tag(r, "displayname") ?? "") || path.split("/").filter(Boolean).pop() || path;
      list.push({ id: path, name, href });
    }
    const only = this.o.only.map((x) => x.toLowerCase());
    this.cache = { at: this.now(), list: only.length ? list.filter((c) => only.includes(c.name.toLowerCase())) : list };
    return this.cache.list;
  }

  async events(from: string, to: string): Promise<CalendarEvent[]> {
    const start = stamp(dayBounds(this.o.timezone, from)[0]);
    const end = stamp(dayBounds(this.o.timezone, addDays(to, 0))[1]);
    const out: CalendarEvent[] = [];
    for (const cal of await this.list()) {
      const xml = await this.dav("REPORT", cal.href, "1",
        `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`);
      for (const r of responses(xml)) {
        const data = tag(r, "calendar-data");
        if (!data) continue;
        for (const e of parseIcal(decode(data.replace(/^<!\[CDATA\[|\]\]>$/g, "")), this.o.timezone)) {
          if (e.cancelled) continue;
          out.push({ calendar: cal.name, title: e.title, start: e.start, ...(e.end ? { end: e.end } : {}), allDay: e.allDay, ...(e.location ? { location: e.location } : {}) });
        }
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }
}

const config = z.object({
  url: z.string().url().meta(F("CalDAV address", "CalDAV 주소", ["Naver: https://caldav.calendar.naver.com · Synology: https://<your NAS>:5001/caldav/ · Nextcloud: https://<server>/remote.php/dav", "네이버: https://caldav.calendar.naver.com · 시놀로지: https://<내 NAS>:5001/caldav/ · Nextcloud: https://<서버>/remote.php/dav"])),
  username: z.string().min(1).max(200).meta(F("Username", "아이디")),
  calendars: z.string().max(500).optional().meta(F("Only these calendars (optional)", "이 캘린더만 (선택)", ["Calendar names, comma separated. Empty: every calendar of the account.", "캘린더 이름을 쉼표로 구분해요. 비우면 계정의 모든 캘린더를 읽어요."])),
  allowPrivateNetwork: z.boolean().default(false).meta(F("The server is on my home network", "서버가 집 네트워크 안에 있어요", ["Tick for a home address such as a NAS (192.168.x.x, nas.local).", "NAS처럼 집 안 주소(192.168.x.x, nas.local)면 체크하세요."])),
});
const secrets = z.object({ password: z.string().min(1).meta(F("Password", "비밀번호", ["Use an app password where the service offers one (Naver: My info → Security → App password).", "서비스가 앱 비밀번호를 주면 그걸 쓰세요 (네이버: 내정보 → 보안설정 → 애플리케이션 비밀번호)."])) });
const make = (url: string) => ({ config, fetch, timezone }: any, s: any) => new CalDav({ url, username: config.username, password: s.password, only: (config.calendars ?? "").split(",").map((x: string) => x.trim()).filter(Boolean), timezone }, fetch);

export const caldavProvider = defineProvider({
  kind: "calendar",
  id: "caldav",
  title: T("CalDAV calendar (Naver, Synology, Nextcloud, Fastmail …)", "CalDAV 캘린더 (네이버·시놀로지·Nextcloud·Fastmail …)"),
  config,
  secrets,
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: (ctx) => make(ctx.config.url)(ctx, ctx.secrets),
  test: async (c) => {
    if (!(await (c as CalDav).calendars()).length) throw new Error("signed in, but no calendars were found");
  },
});

/** iCloud: fixed address; Apple moves each account to its own pNN-caldav.icloud.com host. */
export const icloudCalendarProvider = defineProvider({
  kind: "calendar",
  id: "icloud",
  title: T("iCloud Calendar", "iCloud 캘린더"),
  config: z.object({
    username: z.string().min(3).max(200).meta(F("Apple ID", "Apple ID", ["The email you sign in to iCloud with.", "iCloud에 로그인하는 메일 주소예요."])),
    calendars: z.string().max(500).optional().meta(F("Only these calendars (optional)", "이 캘린더만 (선택)", ["Calendar names, comma separated. Empty: every calendar of the account.", "캘린더 이름을 쉼표로 구분해요. 비우면 계정의 모든 캘린더를 읽어요."])),
  }),
  secrets: z.object({ password: z.string().min(1).meta(F("App-specific password", "앱 암호", ["appleid.apple.com → Sign-In and Security → App-Specific Passwords → make one named memexhub. Not your Apple ID password.", "appleid.apple.com → 로그인 및 보안 → 앱 암호 → memexhub 이름으로 하나 만드세요. Apple ID 비밀번호가 아니에요."])) }),
  runtimes: ["node", "workers"],
  hosts: () => ["caldav.icloud.com", "*.icloud.com"],
  create: (ctx) => make("https://caldav.icloud.com/")(ctx, ctx.secrets),
  test: async (c) => {
    if (!(await (c as CalDav).calendars()).length) throw new Error("signed in, but no calendars were found");
  },
});

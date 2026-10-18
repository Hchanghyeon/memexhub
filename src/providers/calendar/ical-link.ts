import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import { dayBounds } from "../../core/time.js";
import { expandIcal, feedName } from "./recur.js";
import type { CalendarEvent, CalendarInfo, CalendarProvider } from "./types.js";

/** webcal:// is the same feed over https. */
export const feedUrl = (u: string) => u.trim().replace(/^webcal:\/\//i, "https://");

/**
 * A calendar read from its iCal link (Google "secret address in iCal format", iCloud public calendar, Outlook
 * "publish", any .ics URL): no sign-in, read-only. The link works like a password, so it is kept as a secret.
 */
export class IcalLink implements CalendarProvider {
  private cache?: { at: number; text: string };
  constructor(
    private o: { url: string; name?: string; timezone: string },
    private f: typeof fetch,
    private now: () => number = () => Date.now(),
  ) {}

  private async text() {
    // Feeds are refreshed by their services every few hours; ten minutes is plenty here.
    if (this.cache && this.now() - this.cache.at < 600_000) return this.cache.text;
    const r = await this.f(new URL(feedUrl(this.o.url)), { headers: { accept: "text/calendar, */*" } });
    if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error(`the calendar link was refused (${r.status}): copy the link again`);
    if (!r.ok) throw new Error(`calendar link ${r.status}`);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("this link is not an iCal calendar (.ics)");
    this.cache = { at: this.now(), text };
    return text;
  }

  async calendars(): Promise<CalendarInfo[]> {
    return [{ id: "feed", name: this.o.name || feedName(await this.text()) || "iCal" }];
  }

  async events(from: string, to: string): Promise<CalendarEvent[]> {
    const text = await this.text();
    const name = this.o.name || feedName(text) || "iCal";
    const [a] = dayBounds(this.o.timezone, from);
    const [, b] = dayBounds(this.o.timezone, to);
    return expandIcal(text, this.o.timezone, a, b).filter((e) => !e.cancelled).map(({ cancelled: _c, ...e }) => ({ calendar: name, ...e }));
  }
}

export const icalLinkProvider = defineProvider({
  kind: "calendar",
  id: "ical",
  title: T("Calendar link (iCal)", "캘린더 링크 (iCal)"),
  config: z.object({
    name: z.string().max(60).optional().meta(F("Calendar name (optional)", "캘린더 이름 (선택)", ["Shown in summaries, e.g. Family. Empty: the name inside the link.", "요약에 보일 이름이에요. 예: 가족. 비우면 링크 안에 적힌 이름을 써요."])),
    allowPrivateNetwork: z.boolean().default(false).meta(F("The link is on my home network", "링크가 집 네트워크 안에 있어요", ["Only for a calendar served from home (http://192.168.x.x …).", "집 안 서버에서 나오는 캘린더일 때만 체크하세요 (http://192.168.x.x …)."])),
  }),
  secrets: z.object({
    url: z.string().min(10).max(2000).meta(F("iCal link", "iCal 링크", [
      "Google Calendar: settings of the calendar → Integrate calendar → Secret address in iCal format. iCloud: share the calendar as public → copy the link (webcal:// is fine). Each calendar has its own link. Keep it private: anyone with it can read the calendar.",
      "구글 캘린더: 그 캘린더의 설정 → 캘린더 통합 → iCal 형식의 비밀 주소. iCloud: 캘린더를 공개로 공유 → 링크 복사 (webcal:// 그대로 넣어도 돼요). 캘린더마다 링크가 따로 있어요. 링크를 아는 사람은 누구나 볼 수 있으니 남에게 보이지 마세요.",
    ])),
  }),
  runtimes: ["node", "workers"],
  hosts: (_c: any, s?: any) => { try { return s?.url ? [new URL(feedUrl(s.url)).hostname] : []; } catch { return []; } },
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch, timezone }) => new IcalLink({ url: secrets.url, name: config.name, timezone }, fetch),
  test: async (c) => {
    await (c as IcalLink).calendars();
  },
});

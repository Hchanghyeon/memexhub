import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { addDays, localDate, nowIn } from "../../core/time.js";
import type { CalendarEvent, CalendarProvider } from "../../providers/calendar/types.js";

const hm = (iso: string, tz: string) => {
  const p = nowIn(tz, new Date(iso));
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};
/** "09:00–10:30 Title @ Place (Calendar)"; all-day events first, as "all day". */
export function eventLine(e: CalendarEvent, tz: string, lang: "en" | "ko") {
  const when = e.allDay ? (lang === "ko" ? "종일" : "all day") : `${hm(e.start, tz)}${e.end ? `–${hm(e.end, tz)}` : ""}`;
  return `${when} ${e.title}${e.location ? ` @ ${e.location}` : ""} (${e.calendar})`;
}
/** Events touching a local day (multi-day events count on every day they cover). */
export function onDay(e: CalendarEvent, date: string, tz: string) {
  if (e.allDay) return e.start <= date && (e.end ? date < e.end : date === e.start);
  const s = localDate(tz, new Date(e.start));
  const en = e.end ? localDate(tz, new Date(+new Date(e.end) - 1)) : s;
  return s <= date && date <= en;
}

export default defineModule({
  id: "calendar",
  title: T("Calendar", "캘린더"),
  setup: async ({ provider, connections, settings, platform }) => {
    const accounts = await connections("calendar");
    const tz = settings.timezone;
    const lang = settings.toolLanguage === "ko" ? "ko" : "en";
    const get = async (a: string) => {
      const p = await provider<CalendarProvider>("calendar", a);
      if (!p) throw new Error(`no calendar account named "${a}" (${accounts.join(", ") || "none connected"})`);
      return p;
    };
    const events = async (from: string, to: string, only?: string) => {
      const out: { account: string; events?: CalendarEvent[]; error?: string }[] = [];
      for (const a of only ? [only] : accounts) {
        try {
          const list = await (await get(a)).events(from, to);
          // With several accounts, every line says which one it came from.
          out.push({ account: a, events: accounts.length > 1 ? list.map((e) => ({ ...e, calendar: `${e.calendar} · ${a}` })) : list });
        } catch (e) {
          out.push({ account: a, error: (e as Error).message.slice(0, 160) });
        }
      }
      return out;
    };
    return {
      summary: {
        async day(date) {
          const lines: string[] = [];
          for (const r of await events(date, date)) {
            if (r.error) lines.push(`${r.account}: unavailable (${r.error})`);
            else for (const e of r.events!.filter((x) => onDay(x, date, tz)).sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.start.localeCompare(y.start))) lines.push(eventLine(e, tz, lang));
          }
          return lines.length ? lines : undefined;
        },
      },
      tools: [
        defineTool({
          name: "calendar_list",
          readOnly: true,
          description: T("Connected calendar accounts and their calendars.", "연결된 캘린더 계정과 그 안의 캘린더들."),
          input: {},
          async run() {
            if (!accounts.length) return "no calendar connected: admin UI → Connections → Calendar";
            const out: string[] = [];
            for (const a of accounts) {
              try {
                out.push(`${a}: ${(await (await get(a)).calendars()).map((c) => c.name).join(", ") || "(no calendars)"}`);
              } catch (e) {
                out.push(`${a}: unavailable (${(e as Error).message.slice(0, 160)})`);
              }
            }
            return out.join("\n");
          },
        }),
        defineTool({
          name: "calendar_events",
          readOnly: true,
          description: T(
            "Events from the connected calendars, day by day (recurring events included). Default: today. Read-only.",
            "연결된 캘린더의 일정을 날짜별로 (반복 일정 포함). 기본은 오늘. 읽기 전용.",
          ),
          input: {
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            days: z.number().int().min(1).max(62).default(1),
            account: z.string().max(32).optional().describe(`Account / 계정: ${accounts.join(", ") || "-"}`),
          },
          async run({ date, days, account }) {
            if (!accounts.length) return "no calendar connected: admin UI → Connections → Calendar";
            const from = date ?? localDate(tz, platform.now());
            const to = addDays(from, days - 1);
            const res = await events(from, to, account);
            const out: string[] = res.filter((r) => r.error).map((r) => `${r.account}: unavailable (${r.error})`);
            const all = res.flatMap((r) => r.events ?? []);
            for (let d = from; d <= to; d = addDays(d, 1)) {
              const today = all.filter((e) => onDay(e, d, tz)).sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.start.localeCompare(y.start));
              if (today.length) out.push(`${d}`, ...today.map((e) => `- ${eventLine(e, tz, lang)}`));
            }
            return out.join("\n") || "no events";
          },
        }),
      ],
    };
  },
});

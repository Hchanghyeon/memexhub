import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import { dayBounds } from "../../core/time.js";
import { GOOGLE, GoogleToken } from "../google/auth.js";
import type { CalendarEvent, CalendarInfo, CalendarProvider } from "./types.js";

const API = "https://www.googleapis.com/calendar/v3";

/** Google Calendar API, read-only scope. Recurring events come expanded (singleEvents). */
export class GoogleCalendar implements CalendarProvider {
  private auth: GoogleToken;
  private cache?: { at: number; list: CalendarInfo[] };
  constructor(
    private o: { clientId: string; clientSecret: string; refreshToken?: string; only: string[]; timezone: string },
    f: typeof fetch,
    private now: () => number = () => Date.now(),
  ) {
    this.auth = new GoogleToken(o, f, now);
  }

  async calendars(): Promise<CalendarInfo[]> {
    if (this.cache && this.now() - this.cache.at < 3600_000) return this.cache.list;
    const u = new URL(`${API}/users/me/calendarList`);
    u.searchParams.set("maxResults", "250");
    const items = ((await this.auth.api(u)).items ?? []) as { id: string; summary?: string; summaryOverride?: string; hidden?: boolean }[];
    const only = this.o.only.map((x) => x.toLowerCase());
    const list = items.filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id }));
    this.cache = { at: this.now(), list: only.length ? list.filter((c) => only.includes(c.name.toLowerCase())) : list };
    return this.cache.list;
  }

  async events(from: string, to: string): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    for (const cal of await this.calendars()) {
      const u = new URL(`${API}/calendars/${encodeURIComponent(cal.id)}/events`);
      for (const [k, v] of Object.entries({ timeMin: dayBounds(this.o.timezone, from)[0].toISOString(), timeMax: dayBounds(this.o.timezone, to)[1].toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" })) u.searchParams.set(k, v);
      for (const e of ((await this.auth.api(u)).items ?? []) as any[]) {
        if (e.status === "cancelled" || !e.start) continue;
        const allDay = !!e.start.date;
        const start = allDay ? String(e.start.date) : new Date(e.start.dateTime).toISOString();
        const end = e.end ? (allDay ? String(e.end.date) : new Date(e.end.dateTime).toISOString()) : undefined;
        out.push({ calendar: cal.name, title: String(e.summary ?? "") || "(no title)", start, ...(end ? { end } : {}), allDay, ...(e.location ? { location: String(e.location) } : {}) });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }
}

export const googleCalendarProvider = defineProvider({
  kind: "calendar",
  id: "google",
  title: T("Google Calendar", "Google 캘린더"),
  config: z.object({
    clientId: z.string().min(10).max(200).describe("OAuth client ID (Google Cloud → APIs & Services → Credentials, type Web application)"),
    calendars: z.string().max(500).optional().describe("Only these calendars, comma separated (empty = all)"),
    email: z.string().max(200).optional().describe("@internal"), // set by the sign-in callback
  }),
  secrets: z.object({
    clientSecret: z.string().min(1).describe("OAuth client secret"),
    refreshToken: z.string().optional().describe("@internal"),
  }),
  runtimes: ["node", "workers"],
  hosts: () => [...GOOGLE.hosts, "www.googleapis.com"],
  create: ({ config, secrets, fetch, timezone }) =>
    new GoogleCalendar({ clientId: config.clientId, clientSecret: secrets.clientSecret, refreshToken: secrets.refreshToken, only: (config.calendars ?? "").split(",").map((x: string) => x.trim()).filter(Boolean), timezone }, fetch),
  test: async (c) => {
    await (c as GoogleCalendar).calendars();
  },
});

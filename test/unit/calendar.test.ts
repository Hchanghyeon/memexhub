import { describe, expect, it } from "vitest";
import { parseIcal, icalTime } from "../../src/providers/calendar/ical.js";
import { CalDav } from "../../src/providers/calendar/caldav.js";
import { eventLine, onDay } from "../../src/modules/calendar/index.js";
import { guardedFetch } from "../../src/core/guarded-fetch.js";

const ICS = [
  "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "DTSTART;TZID=Asia/Seoul:20261016T090000", "DTEND;TZID=Asia/Seoul:20261016T103000",
  "SUMMARY:Team sync\\, weekly", "LOCATION:Room 2", "END:VEVENT",
  "BEGIN:VEVENT", "UID:2", "DTSTART:20261016T030000Z", "DTEND:20261016T040000Z", "SUMMARY:Lunch with a ", " friend", "END:VEVENT",
  "BEGIN:VEVENT", "UID:3", "DTSTART;VALUE=DATE:20261016", "DTEND;VALUE=DATE:20261018", "SUMMARY:Trip", "END:VEVENT",
  "BEGIN:VEVENT", "UID:4", "DTSTART:20261016T100000Z", "SUMMARY:Gone", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "UID:5", "DTSTART;TZID=Korea Standard Time:20261016T200000", "SUMMARY:Floating", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("iCalendar", () => {
  it("reads times in their zone, all-day dates, folded and escaped text, cancellations", () => {
    const e = parseIcal(ICS, "Asia/Seoul");
    expect(e.map((x) => x.title)).toEqual(["Team sync, weekly", "Lunch with a friend", "Trip", "Gone", "Floating"]);
    expect(e[0]).toMatchObject({ start: "2026-10-16T00:00:00.000Z", end: "2026-10-16T01:30:00.000Z", allDay: false, location: "Room 2" });
    expect(e[2]).toMatchObject({ start: "2026-10-16", end: "2026-10-18", allDay: true });
    expect(e[3]!.cancelled).toBe(true);
    expect(e[4]!.start).toBe("2026-10-16T11:00:00.000Z"); // unknown TZID → hub time zone
    expect(icalTime("", "garbage", "UTC")).toBeUndefined();
  });

  it("puts events on the days they cover and writes one line each", () => {
    const [sync, , trip] = parseIcal(ICS, "Asia/Seoul").map((x) => ({ ...x, calendar: "Work" }));
    expect(eventLine(sync!, "Asia/Seoul", "en")).toBe("09:00–10:30 Team sync, weekly @ Room 2 (Work)");
    expect(eventLine(trip!, "Asia/Seoul", "ko")).toBe("종일 Trip (Work)");
    expect(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map((d) => onDay(trip!, d, "Asia/Seoul"))).toEqual([false, true, true, false]);
  });
});

describe("CalDAV", () => {
  it("discovers calendars across hosts (iCloud style) and expands a range", async () => {
    const seen: string[] = [];
    const ms = (body: string) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`, { status: 207 });
    const server = (async (u: URL, init: RequestInit) => {
      const url = new URL(u);
      seen.push(`${init.method} ${url.host}${url.pathname}`);
      expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${btoa("me@example.com:app-pass")}`);
      const body = String(init.body);
      if (body.includes("current-user-principal")) return ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/1234/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`);
      if (body.includes("calendar-home-set")) return ms(`<d:response><d:href>/1234/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>https://p42-caldav.icloud.com:443/1234/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`);
      if (init.method === "PROPFIND")
        return ms(
          `<d:response><d:href>/1234/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
          `<d:response><d:href>/1234/calendars/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work &amp; Life</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>` +
          `<d:response><d:href>/1234/calendars/todo/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
        );
      expect(body).toContain('<c:expand start="20261015T150000Z" end="20261017T150000Z"/>');
      return ms(`<d:response><d:href>/1234/calendars/work/1.ics</d:href><d:propstat><d:prop><c:calendar-data>${ICS.replace(/&/g, "&amp;")}</c:calendar-data></d:prop></d:propstat></d:response>`);
    }) as unknown as typeof fetch;
    const f = guardedFetch(server, { hosts: ["caldav.icloud.com", "*.icloud.com"], allowPrivate: false });
    const cal = new CalDav({ url: "https://caldav.icloud.com/", username: "me@example.com", password: "app-pass", only: [], timezone: "Asia/Seoul" }, f);
    expect(await cal.calendars()).toEqual([{ id: "/1234/calendars/work/", name: "Work & Life" }]);
    const ev = await cal.events("2026-10-16", "2026-10-17");
    expect(ev.map((e) => e.title)).toEqual(["Trip", "Team sync, weekly", "Lunch with a friend", "Floating"]);
    expect(ev.every((e) => e.calendar === "Work & Life")).toBe(true);
    expect(seen.at(-1)).toBe("REPORT p42-caldav.icloud.com/1234/calendars/work/");
  });

  it("explains a refused sign-in", async () => {
    const cal = new CalDav({ url: "https://dav.example.com/", username: "u", password: "p", only: [], timezone: "UTC" }, (async () => new Response("", { status: 401 })) as unknown as typeof fetch);
    await expect(cal.calendars()).rejects.toThrow(/sign-in refused/);
  });
});

describe("guarded fetch host wildcards", () => {
  it("allows subdomains of a *. entry only", async () => {
    const ok = (async () => new Response("ok")) as unknown as typeof fetch;
    const f = guardedFetch(ok, { hosts: ["*.icloud.com"], allowPrivate: false });
    expect((await f("https://p01-caldav.icloud.com/")).status).toBe(200);
    await expect(f("https://icloud.com/")).rejects.toThrow(/host not allowed/);
    await expect(f("https://evilicloud.com/")).rejects.toThrow(/host not allowed/);
    await expect(f("https://icloud.com.evil.example/")).rejects.toThrow(/host not allowed/);
    const tld = guardedFetch(ok, { hosts: ["*.com"], allowPrivate: false });
    await expect(tld("https://example.com/")).rejects.toThrow(/host not allowed/);
  });
});

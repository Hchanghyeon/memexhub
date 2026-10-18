import { describe, expect, it } from "vitest";
import { expandIcal, feedName } from "../../src/providers/calendar/recur.js";
import { IcalLink, feedUrl } from "../../src/providers/calendar/ical-link.js";

const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nX-WR-CALNAME:Sample\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR`;
const range = (a: string, b: string) => [new Date(a), new Date(b)] as const;
const starts = (text: string, a: string, b: string, tz = "Asia/Seoul") => expandIcal(text, tz, ...range(a, b)).map((e) => `${e.start}${e.cancelled ? " x" : ""} ${e.title}`);

describe("iCal recurring events", () => {
  it("weekly on two days with a count; the first occurrence counts", () => {
    const t = cal("UID:a\r\nSUMMARY:Gym\r\nDTSTART;TZID=Asia/Seoul:20261005T190000\r\nDTEND;TZID=Asia/Seoul:20261005T200000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4");
    expect(starts(t, "2026-10-01T00:00:00Z", "2026-11-30T00:00:00Z")).toEqual([
      "2026-10-05T10:00:00.000Z Gym", "2026-10-08T10:00:00.000Z Gym", "2026-10-12T10:00:00.000Z Gym", "2026-10-15T10:00:00.000Z Gym",
    ]);
  });

  it("monthly on the second Monday, every other month, until a date", () => {
    const t = cal("UID:b\r\nSUMMARY:Review\r\nDTSTART;TZID=Asia/Seoul:20260112T100000\r\nRRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2MO;UNTIL=20260731T000000Z");
    expect(starts(t, "2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z")).toEqual(["2026-01-12T01:00:00.000Z Review", "2026-03-09T01:00:00.000Z Review", "2026-05-11T01:00:00.000Z Review", "2026-07-13T01:00:00.000Z Review"]);
  });

  it("yearly all-day birthdays show in a far-later range; the 31st skips short months", () => {
    const t = cal("UID:c\r\nSUMMARY:Birthday\r\nDTSTART;VALUE=DATE:20200318\r\nDTEND;VALUE=DATE:20200319\r\nRRULE:FREQ=YEARLY", "UID:d\r\nSUMMARY:Rent\r\nDTSTART;VALUE=DATE:20260131\r\nRRULE:FREQ=MONTHLY");
    expect(starts(t, "2026-03-01T00:00:00Z", "2026-04-15T00:00:00Z")).toEqual(["2026-03-18 Birthday", "2026-03-31 Rent"]);
    const b = expandIcal(t, "Asia/Seoul", ...range("2026-03-17T00:00:00Z", "2026-03-19T00:00:00Z")).find((e) => e.title === "Birthday")!;
    expect(b).toMatchObject({ allDay: true, start: "2026-03-18", end: "2026-03-19" });
  });

  it("skips EXDATEs, shows a moved occurrence at its new time, and a cancelled one as cancelled", () => {
    const t = cal(
      "UID:e\r\nSUMMARY:Standup\r\nDTSTART;TZID=Asia/Seoul:20261019T093000\r\nDURATION:PT15M\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE;TZID=Asia/Seoul:20261020T093000",
      "UID:e\r\nRECURRENCE-ID;TZID=Asia/Seoul:20261021T093000\r\nSUMMARY:Standup (moved)\r\nDTSTART;TZID=Asia/Seoul:20261021T140000\r\nDTEND;TZID=Asia/Seoul:20261021T141500",
      "UID:e\r\nRECURRENCE-ID;TZID=Asia/Seoul:20261022T093000\r\nSUMMARY:Standup\r\nSTATUS:CANCELLED\r\nDTSTART;TZID=Asia/Seoul:20261022T093000",
    );
    expect(starts(t, "2026-10-18T00:00:00Z", "2026-10-25T00:00:00Z")).toEqual([
      "2026-10-19T00:30:00.000Z Standup", "2026-10-21T05:00:00.000Z Standup (moved)", "2026-10-22T00:30:00.000Z x Standup", "2026-10-23T00:30:00.000Z Standup",
    ]);
    expect(expandIcal(t, "Asia/Seoul", ...range("2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z"))[0]!.end).toBe("2026-10-19T00:45:00.000Z");
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    const t = cal("UID:f\r\nSUMMARY:Call\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nRRULE:FREQ=WEEKLY");
    expect(starts(t, "2026-10-25T00:00:00Z", "2026-11-10T00:00:00Z", "UTC")).toEqual(["2026-10-26T13:00:00.000Z Call", "2026-11-02T14:00:00.000Z Call", "2026-11-09T14:00:00.000Z Call"]);
  });

  it("reads the feed name and turns webcal:// into https://", () => {
    expect(feedName(cal())).toBe("Sample");
    expect(feedUrl(" webcal://p01-caldav.icloud.com/published/2/abc ")).toBe("https://p01-caldav.icloud.com/published/2/abc");
  });
});

describe("iCal link provider", () => {
  const text = cal("UID:g\r\nSUMMARY:Dinner\r\nDTSTART;TZID=Asia/Seoul:20261016T190000\r\nDTEND;TZID=Asia/Seoul:20261016T210000");
  it("fetches once in ten minutes, names the calendar, and refuses what is not a calendar", async () => {
    let calls = 0;
    const f = (async () => (calls++, new Response(text))) as unknown as typeof fetch;
    const p = new IcalLink({ url: "webcal://cal.example.com/secret.ics", timezone: "Asia/Seoul" }, f, () => 0);
    expect(await p.calendars()).toEqual([{ id: "feed", name: "Sample" }]);
    expect(await p.events("2026-10-16", "2026-10-16")).toEqual([{ calendar: "Sample", title: "Dinner", start: "2026-10-16T10:00:00.000Z", end: "2026-10-16T12:00:00.000Z", allDay: false }]);
    expect(calls).toBe(1);
    const bad = new IcalLink({ url: "https://cal.example.com/x", timezone: "UTC" }, (async () => new Response("<html>")) as unknown as typeof fetch);
    await expect(bad.calendars()).rejects.toThrow(/not an iCal calendar/);
  });
});

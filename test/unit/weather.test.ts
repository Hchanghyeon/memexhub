import { describe, expect, it } from "vitest";
import { OpenMeteo } from "../../src/providers/weather/open-meteo.js";
import { sky, weatherLine } from "../../src/modules/weather/index.js";

const reply = (from: string, n: number, code = 61) => {
  const time = Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10));
  return { daily: { time, weather_code: time.map(() => code), temperature_2m_max: time.map(() => 21.4), temperature_2m_min: time.map(() => 12.6), precipitation_sum: time.map(() => 3.25) } };
};

describe("Open-Meteo weather", () => {
  it("uses the forecast API for recent days and the archive for older ones, with rounded coordinates", async () => {
    const calls: URL[] = [];
    const f = (async (u: URL) => {
      calls.push(new URL(u));
      const q = new URL(u).searchParams;
      const days = (Date.parse(q.get("end_date")!) - Date.parse(q.get("start_date")!)) / 86_400_000 + 1;
      return new Response(JSON.stringify(reply(q.get("start_date")!, days)));
    }) as unknown as typeof fetch;
    const w = new OpenMeteo({ place: "Sample City", latitude: 37.123456, longitude: 127.987654, timezone: "Asia/Seoul" }, f, () => new Date("2026-10-16T03:00:00Z"));
    const days = await w.days("2026-07-15", "2026-07-20");
    expect(days.map((d) => d.date)).toEqual(["2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]);
    expect(calls.map((u) => u.hostname)).toEqual(["archive-api.open-meteo.com", "api.open-meteo.com"]);
    expect(calls[0]!.searchParams.get("end_date")).toBe("2026-07-17");
    expect(calls[1]!.searchParams.get("start_date")).toBe("2026-07-18");
    expect(calls[0]!.searchParams.get("latitude")).toBe("37.12");
    expect(calls[0]!.searchParams.get("longitude")).toBe("127.99");
    calls.length = 0;
    await w.days("2026-10-16", "2026-12-31");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("end_date")).toBe("2026-10-31"); // capped at 15 days ahead
  });

  it("reads codes and writes one line per day", () => {
    expect(sky(0, "ko")).toBe("맑음");
    expect(sky(63, "en")).toBe("rain");
    expect(sky(1234, "ko")).toBe("알 수 없음");
    expect(weatherLine({ date: "2026-10-16", code: 61, max: 21.4, min: 12.6, rain: 3.25 }, "ko")).toBe("비 · 최고 21° 최저 13° · 강수 3.3 mm");
    expect(weatherLine({ date: "2026-10-16", code: 0, max: 20, min: null, rain: 0 }, "en")).toBe("clear · high 20° low ?");
  });

  it("refuses an error response", async () => {
    const w = new OpenMeteo({ place: "x", latitude: 1, longitude: 1, timezone: "UTC" }, (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch, () => new Date("2026-10-16T00:00:00Z"));
    await expect(w.days("2026-10-16", "2026-10-16")).rejects.toThrow(/Open-Meteo 400/);
  });
});

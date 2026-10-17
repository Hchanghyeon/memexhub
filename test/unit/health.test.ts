import { describe, expect, it } from "vitest";
import { fromHealthAutoExport, fromShortcut, minutes, num, parseDt, parseSleep, parseWorkouts } from "../../src/modules/health/parse.js";
import { dayLine, mergeDays, renderHealthNote } from "../../src/modules/health/render.js";

const TZ = "Asia/Seoul";
const NOW = new Date("2026-10-15T00:30:00Z");
const SLEEP = "2026-10-13 23:40|2026-10-14 01:10|코어\n2026-10-14 01:10|2026-10-14 01:40|깊은\n2026-10-14 01:40|2026-10-14 02:00|깨어 있음\n2026-10-14 02:00|2026-10-14 04:30|렘\n2026-10-14 04:30|2026-10-14 06:50|코어\n2026-10-14 13:00|2026-10-14 13:30|수면";

describe("health parsing (same results as the reference implementation)", () => {
  it("sleep: longest group is last night, stages and awakenings", () => {
    expect(parseSleep(SLEEP, TZ)).toEqual({ wake_date: "2026-10-14", start: "23:40", end: "06:50", asleep_min: 410, awake_n: 1, awake_min: 20, deep_min: 30, rem_min: 150, core_min: 230 });
  });
  it("workouts and odd number / time formats", () => {
    expect(parseWorkouts("달리기|2026. 10. 13. 오후 7:05|0:32:10|310\n요가|2026-10-13 21:00|20분|", TZ)).toEqual([
      { type: "달리기", start: "19:05", min: 32, kcal: 310 },
      { type: "요가", start: "21:00", min: 20 },
    ]);
    expect(num("8,240")).toBe(8240);
    expect(num("6.1 km")).toBe(6.1);
    expect(num("100\n200")).toBe(300);
    expect(minutes("1시간 5분")).toBe(65);
    expect(minutes("1920초")).toBe(32);
    expect(parseDt("2026년 10월 14일 오전 12:40", TZ)).toBe(Date.parse("2026-10-14T00:40:00+09:00"));
    expect(parseDt("2026-10-13 00:00:00 +0900", TZ)).toBe(Date.parse("2026-10-13T00:00:00+09:00"));
  });
  it("renders lines exactly like the reference", () => {
    const w = parseWorkouts("달리기|2026. 10. 13. 오후 7:05|0:32:10|310\n요가|2026-10-13 21:00|20분|", TZ);
    expect(dayLine("2026-10-13", { metrics: { steps: 8240, distance_km: 6.12, active_kcal: 512.4, resting_hr: 58, weight: 70.25, custom_x: 3.5 }, workouts: w }, "ko")).toBe(
      "- 10-13 (화) 걸음 8,240 · 6.1 km · 활동 512 kcal · 안정 심박 58 · 체중 70.2 kg · custom_x 3.5 · 🏃 달리기 32분 310 kcal · 🏃 요가 20분",
    );
    const { wake_date: _w, ...s } = parseSleep(SLEEP, TZ)!;
    expect(dayLine("2026-10-14", { metrics: {}, sleep: s }, "ko")).toBe("- 10-14 (수) 😴 23:40–06:50 · 6시간 50분 (깊은 30분 · 렘 2시간 30분) · 깸 1번(20분)");
    const { wake_date: _x, ...bed } = parseSleep("2026-10-14 23:30|2026-10-15 07:00|침대", TZ)!;
    expect(dayLine("2026-10-15", { metrics: {}, sleep: bed }, "ko")).toBe("- 10-15 (목) 😴 침대 23:30–07:00 (7시간 30분)");
    expect(dayLine("2026-10-15", { metrics: { steps: 1000 }, sleep: bed }, "en")).toBe("- 10-15 (Thu) 😴 in bed 23:30–07:00 (7h 30m) · steps 1,000");
  });
});

describe("payloads", () => {
  it("shortcut: activity to `date` (default yesterday), sleep to its wake date, sleep given as three lists", () => {
    const u = fromShortcut({ steps: "8,240", resting_hr: 58, sleep_start: "2026-10-14 23:30\n2026-10-15 03:00", sleep_end: "2026-10-15 03:00\n2026-10-15 07:00", sleep_value: "코어\n렘" }, TZ, NOW);
    expect(Object.keys(u).sort()).toEqual(["2026-10-14", "2026-10-15"]);
    expect(u["2026-10-14"]!.metrics).toEqual({ steps: 8240, resting_hr: 58 });
    expect(u["2026-10-15"]!.sleep).toMatchObject({ start: "23:30", end: "07:00", asleep_min: 450, rem_min: 240 });
    expect(() => fromShortcut({ note: "hello" }, TZ, NOW)).toThrow(/no health values/);
    expect(() => fromShortcut({ date: "nope", steps: 1 }, TZ, NOW)).toThrow(/YYYY-MM-DD/);
  });
  it("Health Auto Export: sums and averages per day, units, sleep summaries, workouts in seconds", () => {
    const u = fromHealthAutoExport(
      {
        metrics: [
          { name: "step_count", units: "count", data: [{ date: "2026-10-13 00:00:00 +0900", qty: 5000 }, { date: "2026-10-13 12:00:00 +0900", qty: 3240 }] },
          { name: "walking_running_distance", units: "mi", data: [{ date: "2026-10-13 00:00:00 +0900", qty: 2 }] },
          { name: "blood_oxygen_saturation", units: "%", data: [{ date: "2026-10-13 00:00:00 +0900", qty: 0.97 }] },
          { name: "sleep_analysis", data: [{ sleepStart: "2026-10-13 23:40:00 +0900", sleepEnd: "2026-10-14 06:50:00 +0900", totalSleep: 6.5, deep: 0.5, rem: 2.5 }] },
        ],
        workouts: [{ name: "Outdoor Run", start: "2026-10-13 19:05:00 +0900", duration: 1930, activeEnergyBurned: { qty: 1297, units: "kJ" } }],
      },
      TZ,
      NOW,
    );
    expect(u["2026-10-13"]!.metrics).toEqual({ steps: 8240, distance_km: 3.22, spo2: 97 });
    expect(u["2026-10-13"]!.workouts).toEqual([{ type: "Outdoor Run", start: "19:05", min: 32, kcal: 310 }]);
    expect(u["2026-10-14"]!.sleep).toEqual({ start: "23:40", end: "06:50", asleep_min: 390, deep_min: 30, rem_min: 150 });
    expect(() => fromHealthAutoExport({ metrics: [] }, TZ, NOW)).toThrow();
  });
  it("re-sending a date replaces it; notes group by month", () => {
    const days = mergeDays([
      { date: "2026-10-13", update: { metrics: { steps: 100, weight: 70 } } },
      { date: "2026-10-13", update: { metrics: { steps: 8240 }, workouts: [] } },
      { date: "2026-09-30", update: { metrics: { steps: 1 } } },
    ]);
    expect(days.get("2026-10-13")).toEqual({ metrics: { steps: 8240, weight: 70 }, workouts: [] });
    const note = renderHealthNote(days, 2026, { lang: "ko", created: "2026-10-01", today: "2026-10-15" });
    expect(note).toMatch(/## 2026-09\n\n- 09-30 \(수\) 걸음 1\n\n## 2026-10\n\n- 10-13 \(화\) 걸음 8,240 · 체중 70\.0 kg/);
    const oct = renderHealthNote(days, 2026, { lang: "ko", created: "2026-10-01", today: "2026-10-15" }, 10);
    expect(oct).toContain("title: 2026-10 건강 기록");
    expect(oct).not.toContain("09-30");
  });
});

describe("note path patterns", () => {
  it("fills {year} and {month}", async () => {
    const { periodPath, perMonth } = await import("../../src/core/time.js");
    expect(periodPath("40-일지/결제/{year}-{month}.md", 2026, 3)).toBe("40-일지/결제/2026-03.md");
    expect(periodPath("ledger/payments/{year}.md", 2026, 3)).toBe("ledger/payments/2026.md");
    expect([perMonth("a/{year}-{month}.md"), perMonth("a/{year}.md")]).toEqual([true, false]);
  });
});

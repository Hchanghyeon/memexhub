import { describe, expect, it } from "vitest";
import type { DayEvent } from "../../src/core/registry.js";
import { buildScenes, sceneLines } from "../../src/modules/hub/scenes.js";

// A fake Friday in Seoul (UTC+9): times are local.
const at = (hm: string) => Date.parse(`2026-10-16T${hm}:00+09:00`);
const day: DayEvent[] = [
  { kind: "pay", start: at("08:00"), label: "Sample Mall", amount: "₩22,360", online: true },
  { kind: "transit", start: at("08:13"), label: "" },
  { kind: "transit", start: at("08:54"), label: "" },
  { kind: "transit", start: at("09:18"), label: "" },
  { kind: "stay", start: at("09:24"), end: at("15:39"), label: "Office", named: true },
  { kind: "stay", start: at("15:39"), end: at("17:03"), label: "Office", named: true },
  { kind: "office", start: at("09:27"), end: at("17:02"), label: "office", named: true },
  { kind: "pay", start: at("18:02"), label: "Sample Store", amount: "₩3,700" },
  { kind: "event", start: at("18:00"), end: at("20:00"), label: "Dinner with a friend" },
  { kind: "stay", start: at("18:47"), end: at("20:44"), label: "Sample-dong" },
  { kind: "pay", start: at("20:35"), label: "Sample Grill", amount: "₩111,900" },
  { kind: "transit", start: at("21:18"), label: "" },
  { kind: "transit", start: at("22:08"), label: "" },
  { kind: "stay", start: at("22:17"), end: at("23:59"), label: "Home", named: true },
  { kind: "event", start: at("10:00"), end: at("10:30"), label: "Dentist" },
];

describe("day scenes", () => {
  const r = buildScenes(day);

  it("merges the dinner event, the stay and its payment into one scene", () => {
    const dinner = r.scenes.find((s) => s.label === "Sample-dong")!;
    expect(dinner.pays.map((p) => p.label)).toEqual(["Sample Grill"]);
    expect(dinner.events.map((e) => e.label)).toEqual(["Dinner with a friend"]);
  });

  it("joins neighbouring stays of the same place and keeps office taps inside them", () => {
    expect(r.scenes.filter((s) => s.label === "Office")).toHaveLength(1);
    expect(r.scenes.some((s) => s.kind === "office")).toBe(false);
  });

  it("an appointment never lands on an everyday place when another place fits; unmatched events are listed", () => {
    // 10:00 Dentist overlaps only the office: it still joins it (the only candidate), so nothing is unmatched…
    expect(r.unmatched).toEqual([]);
    // …but with the office gone, it has no match.
    const r2 = buildScenes(day.filter((e) => e.label !== "Office" && e.kind !== "office"));
    expect(r2.unmatched.map((e) => e.label)).toEqual(["Dentist"]);
  });

  it("writes one line per scene with what matched, taps outside places as moves", () => {
    const lines = sceneLines(r, "Asia/Seoul", "en");
    expect(lines).toContain("- 18:47–20:44 📍 Sample-dong · 💳 20:35 Sample Grill ₩111,900 · 📅 18:00 Dinner with a friend (from 📍💳📅)");
    expect(lines[0]).toBe("- 08:00 🌐 Sample Mall ₩22,360");
    expect(lines).toContain("- 08:13–09:18 🚇 on the move (3 taps)");
    expect(lines).toContain("- 18:02 💳 Sample Store ₩3,700 (no stay)");
    expect(lines).toContain("- 21:18–22:08 🚇 on the move (2 taps)");
  });

  it("makes an office scene from gate taps when there is no location", () => {
    const r3 = buildScenes(day.filter((e) => e.kind !== "stay"));
    expect(sceneLines(r3, "Asia/Seoul", "ko").find((l) => l.includes("🏢"))).toBe("- 09:27–17:02 🏢 office · 📅 10:00 Dentist (근거 🏢📅)");
  });
});

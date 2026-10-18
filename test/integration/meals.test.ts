import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { testFs } from "../helpers.js";
import { renderMealsNote, slotAt } from "../../src/modules/meals/render.js";

let hub: Hub;
const tool = (name: string) => (a: Record<string, unknown>) => hub.tools.find((t) => t.name === name)!.run(a, { actor: "t" });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-me-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-18T05:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-mev-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("meals", { note: "meals/{year}-{month}.md", language: "ko" });
  await hub.settings.set("modules", { meals: { enabled: true }, hub: { enabled: true } });
  await hub.reload();
});

describe("meals", () => {
  let lunch = "";
  it("records a meal Claude estimated, draws the month's note, and totals the day", async () => {
    const r = String(await tool("meal_add")({ time: "12:20", place: "Sample Diner", items: [{ name: "제육덮밥", amount: "1인분", kcal: 850, protein_g: 35, carbs_g: 110, fat_g: 25 }, { name: "된장국", kcal: 80, protein_g: 6, carbs_g: 8, fat_g: 3 }] }));
    lunch = r.match(/meal_[\w-]+/)![0];
    expect(r).toContain("12:20 점심 제육덮밥 1인분, 된장국 · 930 kcal");
    expect(r).toContain("2026-10-18: 930 kcal · 단백질 41g · 탄수화물 118g · 지방 28g");
    await tool("meal_add")({ time: "08:10", items: [{ name: "Sample Latte", kcal: 190 }] });
    const note = (await hub.vault!.read("meals/2026-10.md")).text;
    expect(note).toContain("### 10-18 (일) · 1,120 kcal");
    expect(note).toContain("| 08:10 | 아침 | Sample Latte | 190 |");
    expect(note).toContain("| 12:20 | 점심 | 제육덮밥 1인분, 된장국 @ Sample Diner | 930 |");
  });

  it("corrects with replaces, cancels by id, and refuses unknown ids", async () => {
    await tool("meal_add")({ time: "12:20", replaces: lunch, items: [{ name: "제육덮밥", amount: "반 공기", kcal: 650 }] });
    let day = String(await tool("meal_day")({}));
    expect(day).toContain("🍽 2번 · 840 kcal");
    expect(day).not.toContain("된장국");
    const latte = day.match(/아침 Sample Latte · 190 kcal \[(meal_[\w-]+)\]/)![1]!;
    expect(String(await tool("meal_cancel")({ id: latte }))).toContain("cancelled");
    day = String(await tool("meal_day")({}));
    expect(day).toContain("🍽 1번 · 650 kcal");
    expect(String(await tool("meal_cancel")({ id: "meal_nope" }))).toBe("no meal with id meal_nope");
    expect(String(await tool("meal_add")({ replaces: "meal_nope", items: [{ name: "x", kcal: 1 }] }))).toBe("no meal with id meal_nope");
    expect((await hub.vault!.read("meals/2026-10.md")).text).not.toContain("Sample Latte");
  });

  it("shows up in day_summary (scene and lines) and week_summary", async () => {
    const day = String(await tool("day_summary")({ date: "2026-10-18" }));
    // A meal with no place to join stands as its own scene; the meals part lists it too.
    expect(day).toContain("- 12:20 🍽 점심 제육덮밥 반 공기 650 kcal");
    expect(day).toContain("## Meals\n🍽 1번 · 650 kcal (어림)");
    expect(String(await tool("week_summary")({ week: "2026-10-18" }))).toContain("하루 평균 섭취: 650 kcal");
  });

  it("guesses the slot from the time and writes an empty note plainly", () => {
    expect([slotAt("07:30"), slotAt("12:00"), slotAt("19:00"), slotAt("23:30")]).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    expect(renderMealsNote([], 2026, { lang: "en", created: "2026-10-01", today: "2026-10-18" }, 10)).toContain("No meals yet.");
  });
});

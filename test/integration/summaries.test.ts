import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { defineProvider } from "../../src/providers/types.js";
import { T } from "../../src/core/i18n.js";
import { isoWeek, weekStart } from "../../src/modules/hub/summary-tools.js";
import type { Point } from "../../src/providers/location/types.js";
import { testFs } from "../helpers.js";

const at = (iso: string) => Date.parse(iso) / 1000;
const pts: Point[] = [];
for (let i = 0; i <= 60; i++) pts.push({ t: at("2026-10-14T08:00:00+09:00") + i * 60, lat: 37.5, lon: 127.0 });
for (let i = 0; i <= 30; i++) pts.push({ t: at("2026-10-14T10:00:00+09:00") + i * 60, lat: 37.51, lon: 127.0 });
const fakeLoc = defineProvider({
  kind: "location", id: "fakeloc", title: T("f", "f"), config: z.object({}), runtimes: ["node"],
  create: () => ({ points: async (a: Date, b: Date) => pts.filter((p) => p.t >= +a / 1000 && p.t < +b / 1000), areas: async () => [{ name: "Home", lat: 37.5, lon: 127.0, radius: 100 }] }),
});

let hub: Hub;
const tool = (n: string) => hub.tools.find((t) => t.name === n)!;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-su-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T03:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-suv-"))), fakeLoc]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  await hub.connections.upsert({ kind: "location", provider: "fakeloc", name: "loc", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("ledger", { ...s.ledger, officePlaces: ["Office"] });
  await hub.settings.set("modules", { ledger: { enabled: true }, location: { enabled: true }, health: { enabled: true } });
  await hub.reload();
  const ingest = (p: string) => hub.ingest.find((r) => r.path === p)!;
  for (const [merchant, amount, time] of [
    ["Sample Cafe", "₩4,500", "2026-10-14T12:30:00+09:00"],
    ["Sample Stream", "₩9,900", "2026-10-14T09:00:00+09:00"],
    ["Sample Stream", "₩9,900", "2026-09-14T09:00:00+09:00"], // a month earlier → recurring
    ["Sample Market", "₩20,000", "2026-10-07T18:00:00+09:00"], // last week
  ] as const)
    await ingest("/ingest/transaction").handle({ merchant, amount, card: "Card", time }, { tokenId: "t" });
  await ingest("/ingest/transaction").handle({ name: "Tmoney", time: "2026-10-14T08:40:00+09:00" }, { tokenId: "t" });
  await ingest("/ingest/health").handle({ date: "2026-10-14", steps: 8000, sleep: "2026-10-13 23:00|2026-10-14 07:00|core" }, { tokenId: "t" });
  await ingest("/ingest/health").handle({ date: "2026-10-07", steps: 4000, sleep: "2026-10-06 23:00|2026-10-07 05:00|core" }, { tokenId: "t" });
});

describe("ISO weeks", () => {
  it("handles year boundaries", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12");
    expect(isoWeek("2026-10-12")).toBe("2026-W42");
    expect(weekStart("2026-W01")).toBe("2025-12-29");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
    expect(weekStart("2026-W42")).toBe("2026-10-12");
  });
});

describe("day_summary", () => {
  it("collects every module's part in one call", async () => {
    const out = await tool("day_summary").run({ date: "2026-10-14" }, { actor: "t" });
    expect(out).toContain("# 2026-10-14 (Wed)");
    expect(out).toMatch(/## Location\n08:00–09:00 Home → 10:00–10:30 \(unnamed\) · \d+\.\d km/);
    expect(out).toContain("## Ledger\n2 payments · total ₩14,400");
    expect(out).toContain("- 12:30 Sample Cafe ₩4,500 (Card)");
    expect(out).toContain("🚇 08:40");
    expect(out).toMatch(/## Health\n😴 23:00–07:00 · 8h 0m · steps 8,000/);
    expect(out).not.toMatch(/37\.5|127\.0/);
    expect(await tool("day_summary").run({ date: "2020-01-01" }, { actor: "t" })).toBe("# 2020-01-01 (Wed)\nno records");
  });
});

describe("week_summary", () => {
  it("compares with the week before and lists top merchants and recurring payments", async () => {
    const out = await tool("week_summary").run({ week: "2026-W42" }, { actor: "t" });
    expect(out).toContain("# 2026-W42 (10-12 – 10-18)");
    expect(out).toContain("- spent: ₩14,400 (−₩5,600 vs last week)");
    expect(out).toContain("- payments: 2 (+1 vs last week)");
    expect(out).toContain("- recurring: Sample Stream ₩9,900");
    expect(out).toContain("- top: Sample Stream ₩9,900 · Sample Cafe ₩4,500");
    expect(out).toContain("- avg sleep: 8.0 h (+2.0 h vs last week)");
    expect(out).toContain("- avg steps: 8,000 (+4,000 vs last week)");
    expect(out).toMatch(/- travelled: \d+\.\d km/);
    expect(await tool("week_summary").run({ week: "2026-10-16" }, { actor: "t" })).toContain("# 2026-W42");
  });
});

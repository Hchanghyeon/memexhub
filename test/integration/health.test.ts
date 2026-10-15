import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { ingestApp } from "../../src/http/ingest.js";
import { testFs } from "../helpers.js";

let hub: Hub, app: Hono, token = "", ledgerOnly = "";
const post = (body: unknown, tok = token) =>
  app.request("https://hub.example.com/ingest/health", { method: "POST", headers: { "x-ingest-token": tok, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-he-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T00:30:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-hev-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("health", { note: "health/{year}.md", language: "ko" });
  await hub.settings.set("modules", { health: { enabled: true } });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", ingestApp(hub));
  token = (await hub.ingestTokens.create("phone", ["health"], "t")).token;
  ledgerOnly = (await hub.ingestTokens.create("other", ["ledger"], "t")).token;
});

describe("health ingest", () => {
  it("records a shortcut payload into the yearly note and health_day", async () => {
    const r = await post({ date: "2026-10-14", steps: "8,240", resting_hr: 58, sleep: "2026-10-13 23:40|2026-10-14 06:50|코어", workouts: "달리기|2026-10-14 19:05|30분|300" });
    expect(await r.json()).toMatchObject({ ok: true, days: 1 });
    const note = (await hub.vault!.read("health/2026.md")).text;
    expect(note).toContain("- 10-14 (수) 😴 23:40–06:50 · 7시간 10분 · 걸음 8,240 · 안정 심박 58 · 🏃 달리기 30분 300 kcal");
    const tool = hub.tools.find((t) => t.name === "health_day")!;
    expect(await tool.run({ date: "2026-10-14" }, { actor: "t" })).toContain("걸음 8,240");
    expect(await tool.run({ date: "2026-01-01" }, { actor: "t" })).toBe("no health records on 2026-01-01");
  });
  it("re-sending the same date replaces the values; wrong scope and junk are refused", async () => {
    await post({ date: "2026-10-14", steps: 9000 });
    const note = (await hub.vault!.read("health/2026.md")).text;
    expect(note).toContain("걸음 9,000");
    expect(note.match(/- 10-14/g)!.length).toBe(1);
    expect((await post({ steps: 1 }, ledgerOnly)).status).toBe(401);
    expect((await post({ hello: "world" })).status).toBe(422);
    expect((await post([1, 2])).status).toBe(422);
  });
});

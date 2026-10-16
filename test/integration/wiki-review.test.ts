import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { PRESETS } from "../../src/modules/wiki/layout.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

let hub: Hub, a: ReturnType<typeof adminClient>;
const dir = mkdtempSync(join(tmpdir(), "mx-rev-"));

beforeAll(async () => {
  mkdirSync(join(dir, "raw"));
  mkdirSync(join(dir, "wiki"));
  writeFileSync(join(dir, "raw", "2026-01-02 Seed list.md"), "---\ntitle: Seed list\n---\nTomatoes in March.\n");
  writeFileSync(join(dir, "wiki", "Tomatoes.md"), "---\ntitle: Tomatoes\nstatus: draft\n---\nSow in March ([[2026-01-02 Seed list]]).\n");
  writeFileSync(join(dir, "wiki", "No frontmatter.md"), "plain\n");
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-revd-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T03:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(dir)]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("wiki", { ...s.wiki, preset: "llm-wiki", roles: PRESETS["llm-wiki"]! });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.reload();
  a = adminClient(hub);
  await a.login();
});

describe("reviewing wiki pages", () => {
  it("the owner confirms a draft, marks it outdated, or sends it back", async () => {
    expect((await a.post("/vault/status", { path: "wiki/Tomatoes.md", status: "stable" })).status).toBe(200);
    const t = readFileSync(join(dir, "wiki", "Tomatoes.md"), "utf8");
    expect(t).toContain("status: stable");
    expect(t).toContain("reviewed: 2026-10-16");
    expect(t).toContain("Sow in March");
    expect((await a.post("/vault/status", { path: "wiki/Tomatoes.md", status: "deprecated" })).status).toBe(200);
    expect(readFileSync(join(dir, "wiki", "Tomatoes.md"), "utf8")).toContain("status: deprecated");
  });

  it("only wiki pages with frontmatter, only known statuses, only the signed-in owner", async () => {
    expect((await a.post("/vault/status", { path: "raw/2026-01-02 Seed list.md", status: "stable" })).status).toBe(400); // sources are never edited
    expect((await a.post("/vault/status", { path: "wiki/No frontmatter.md", status: "stable" })).status).toBe(400);
    expect((await a.post("/vault/status", { path: "wiki/Missing.md", status: "stable" })).status).toBe(404);
    expect((await a.post("/vault/status", { path: "wiki/Tomatoes.md", status: "published" })).status).toBe(400);
    expect((await a.post("/vault/status", { path: "../x.md", status: "stable" })).status).toBe(400);
    expect((await a.post("/vault/status", { path: "wiki/Tomatoes.md", status: "stable" }, { "x-csrf": "wrong" })).status).toBe(403);
    expect((await adminClient(hub).post("/vault/status", { path: "wiki/Tomatoes.md", status: "stable" })).status).toBe(401);
  });

  it("the vault screen shows the write check on (a sources folder exists) and can turn it off", async () => {
    expect((await a.json("/vault")).wiki.gate).toBe(true);
    expect((await a.post("/wiki/gate", { on: false })).status).toBe(200);
    expect((await a.json("/vault")).wiki.gate).toBe(false);
  });
});

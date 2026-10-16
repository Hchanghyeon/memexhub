import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

let hub: Hub, a: ReturnType<typeof adminClient>;
const dir = mkdtempSync(join(tmpdir(), "mx-vv-"));

beforeAll(async () => {
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  writeFileSync(join(dir, "notes", "Hello.md"), "---\ntitle: Hello\n---\n# Hello\nSee [[World]].\n");
  writeFileSync(join(dir, "World.md"), "# World\nsample text\n");
  writeFileSync(join(dir, ".obsidian", "app.json"), "{}");
  writeFileSync(join(dir, ".obsidian", "hidden.md"), "# hidden");
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-vvd-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(dir)]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.reload();
  a = adminClient(hub);
  await a.login();
});

describe("vault viewer API", () => {
  it("lists files without hidden folders, reads notes, searches", async () => {
    const { files } = await a.json("/vault/files");
    expect(files.map((f: { path: string }) => f.path)).toEqual(["notes/Hello.md", "World.md"]);
    expect((await a.json("/vault/note?path=notes/Hello.md")).text).toContain("See [[World]].");
    expect((await a.json("/vault/search?q=sample")).hits.map((h: { path: string }) => h.path)).toEqual(["World.md"]);
  });

  it("refuses paths outside the vault, non-notes, and missing notes", async () => {
    for (const p of ["../etc/passwd.md", "/etc/passwd.md", ".obsidian/app.json", ".obsidian/hidden.md", "notes/../../x.md"]) {
      const r = await a.get(`/vault/note?path=${encodeURIComponent(p)}`);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await r.json())).not.toContain("{}");
    }
    expect((await a.get("/vault/note?path=nope.md")).status).toBe(404);
    expect((await a.get("/vault/note")).status).toBe(400);
  });

  it("needs a signed-in admin", async () => {
    const anon = adminClient(hub);
    expect((await anon.get("/vault/files")).status).toBe(401);
    expect((await anon.get("/vault/note?path=World.md")).status).toBe(401);
  });
});

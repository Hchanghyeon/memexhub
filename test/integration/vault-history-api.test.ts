import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { GitHistory } from "../../src/platform/git-history.js";
import { loadEnv } from "../../src/core/config.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

let hub: Hub, a: ReturnType<typeof adminClient>;
const dir = mkdtempSync(join(tmpdir(), "mx-ha-"));
const gitDir = join(mkdtempSync(join(tmpdir(), "mx-hag-")), "v.git");

beforeAll(async () => {
  writeFileSync(join(dir, "Note.md"), "version one\n");
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-had-")) });
  hub = new Hub(
    { name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} }, vaultHistory: (root) => new GitHistory(gitDir, root) },
    env, MODULES, [testFs(dir)],
  );
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

describe("change history in the admin API", () => {
  it("lists versions, shows one, and puts it back", async () => {
    await hub.vault!.withActor("claude:x").write("Note.md", "version two\n");
    const { available, entries } = await a.json("/vault/history?path=Note.md");
    expect(available).toBe(true);
    expect(entries.map((e: { message: string }) => e.message)).toEqual(["claude:x: write Note.md", "start: the vault as it was"]);
    const old = entries[1].rev;
    expect((await a.json(`/vault/history/show?path=Note.md&rev=${old}`)).text).toBe("version one\n");
    expect((await a.post("/vault/history/restore", { path: "Note.md", rev: old })).status).toBe(200);
    expect(readFileSync(join(dir, "Note.md"), "utf8")).toBe("version one\n");
    expect((await a.json("/vault")).history).toMatchObject({ on: true, available: true, stats: { commits: 3 } });
  });

  it("refuses bad input and strangers", async () => {
    expect((await a.get("/vault/history/show?path=Note.md&rev=HEAD")).status).toBe(400);
    expect((await a.get("/vault/history?path=.obsidian/app.json")).status).toBe(400);
    expect((await a.get("/vault/history/show?path=Note.md&rev=0123456789abcdef")).status).toBe(404);
    expect((await a.post("/vault/history/restore", { path: "Note.md", rev: "abcdef0" }, { "x-csrf": "nope" })).status).toBe(403);
    expect((await adminClient(hub).get("/vault/history?path=Note.md")).status).toBe(401);
  });

  it("can be turned off", async () => {
    expect((await a.post("/vault/history/enabled", { on: false })).status).toBe(200);
    expect((await a.json("/vault/history?path=Note.md")).available).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

let hub: Hub, a: ReturnType<typeof adminClient>;

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-sf-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-sfv-")))]);
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

describe("vault safety settings", () => {
  it("switches destructive tools on and off, and only real destructive tools", async () => {
    const before = await a.json("/claude");
    expect(before.destructive.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(["delete_note", "move_note"]));
    expect(before.tools.map((x: { name: string }) => x.name)).not.toContain("delete_note");
    expect((await a.post("/claude/destructive", { name: "delete_note", enabled: true })).status).toBe(200);
    expect((await a.json("/claude")).tools.map((x: { name: string }) => x.name)).toContain("delete_note");
    await a.post("/claude/destructive", { name: "delete_note", enabled: false });
    expect((await a.json("/claude")).tools.map((x: { name: string }) => x.name)).not.toContain("delete_note");
    expect((await (await a.post("/claude/destructive", { name: "write_note", enabled: true })).json()).error).toBe("invalid_input");
  });

  it("makes the vault read-only and edits protected paths", async () => {
    expect((await a.post("/vault-safety", { readOnly: true, protectedPaths: ["CLAUDE.md", "Private/**"] })).status).toBe(200);
    const s = await a.json("/security");
    expect(s.readOnly).toBe(true);
    expect(s.protectedPaths).toEqual(["CLAUDE.md", "Private/**"]);
    await expect(hub.vault!.withActor("t").write("a.md", "x")).rejects.toThrow(/read-only/);
    await a.post("/vault-safety", { readOnly: false, protectedPaths: ["Private/**"] });
    await hub.vault!.withActor("t").write("a.md", "x");
    await expect(hub.vault!.withActor("t").write("Private/b.md", "x")).rejects.toThrow();
  });

  it("refuses paths that leave the vault", async () => {
    for (const bad of ["../etc/**", "/abs.md", "a/../../b"]) {
      expect((await a.post("/vault-safety", { readOnly: false, protectedPaths: [bad] })).status, bad).toBe(400);
    }
  });
});

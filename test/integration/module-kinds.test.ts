import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { testFs } from "../helpers.js";
import { adminClient } from "../admin-client.js";

let hub: Hub, a: ReturnType<typeof adminClient>;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-kinds-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-kv-")))]);
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

describe("basic and optional features", () => {
  it("a new install has only the basics on, and they cannot be turned off", async () => {
    const on = () => hub.moduleStatus.filter((m) => m.enabled).map((m) => m.id).sort();
    expect(on()).toEqual(["hub", "vault", "wiki"]);
    expect(hub.moduleStatus.every((m) => (m.kind === "basic") === ["hub", "vault", "wiki"].includes(m.id))).toBe(true);
    await a.post("/modules", { on: ["ledger"] }); // wiki left out of the list
    expect(on()).toEqual(["hub", "ledger", "vault", "wiki"]);
  });

  it("the session lists the features that are on, for the menu; tools say where they come from", async () => {
    expect((await a.json("/session")).modules.sort()).toEqual(["hub", "ledger", "vault", "wiki"]);
    const tools = (await a.json("/claude")).tools as { name: string; module: string; basic: boolean }[];
    expect(tools.find((t) => t.name === "search_notes")).toMatchObject({ module: "vault", basic: true });
    expect(tools.find((t) => t.name === "payments_day")).toMatchObject({ module: "ledger", basic: false });
    await a.post("/modules", { on: [] });
    expect((await a.json("/session")).modules).not.toContain("ledger");
  });
});

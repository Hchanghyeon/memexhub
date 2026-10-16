// A throwaway memexhub with fake data for the browser tests: in-memory database, a temp-folder vault,
// the built admin app (npm run build:web) under /admin. Every request is treated as coming from the home network.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { MODULES } from "../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../src/platform/node.js";
import { loadEnv } from "../src/core/config.js";
import { adminApp } from "../src/admin/app.js";
import { nodeAdminAssets } from "../src/platform/node-assets.js";
import { PORTABLE_PROVIDERS } from "../src/providers/registry.js";
import { owntracksProvider } from "../src/providers/location/owntracks.js";
import { testFs } from "../test/helpers.js";

export const E2E_USER = "owner";
export const E2E_PASSWORD = "a-long-test-password";
const port = Number(process.env.E2E_PORT ?? 8799);

const env = loadEnv({ MEMEXHUB_SECRET: "e".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-e2e-")) });
const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-e2ev-"))), ...PORTABLE_PROVIDERS, owntracksProvider]);
const log = console.log;
console.log = () => {};
await hub.init();
console.log = log;
await hub.admin.createAdmin(E2E_USER, E2E_PASSWORD, "e2e");
await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "e2e");
await hub.settings.set("modules", Object.fromEntries(["vault", "wiki", "hub", "ledger", "location", "health"].map((m) => [m, { enabled: true }])));
const s = await hub.settings.get();
await hub.settings.set("vault", { ...s.vault, connection: "vault" });
await hub.settings.set("wiki", { ...s.wiki, preset: "llm-wiki" });
await hub.settings.set("onboarded", true);
await hub.settings.set("timezone", "Asia/Seoul");
await hub.reload();
await hub.ingestTokens.create("Sample phone", ["ledger"], "e2e");

const app = new Hono()
  .use("*", (c: any, next: () => Promise<void>) => (c.set("ip", "10.0.0.9"), next()))
  .route("/admin", adminApp(hub, { vaultRoots: ["/vaults"], builtinVault: "", base: "/admin", assets: nodeAdminAssets() }));
serve({ fetch: app.fetch, port });
console.log(`e2e server on ${port}`);

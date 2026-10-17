// A throwaway memexhub with fake data for the browser tests: in-memory database, a temp-folder vault,
// the built admin app (npm run build:web) under /admin. Every request is treated as coming from the home network.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { MODULES } from "../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../src/platform/node.js";
import { loadEnv } from "../src/core/config.js";
import { ingestApp } from "../src/http/ingest.js";
import { PRESETS } from "../src/modules/wiki/layout.js";
import { GitHistory } from "../src/platform/git-history.js";
import { adminApp } from "../src/admin/app.js";
import { nodeAdminAssets } from "../src/platform/node-assets.js";
import { PORTABLE_PROVIDERS } from "../src/providers/registry.js";
import { testFs } from "../test/helpers.js";

export const E2E_USER = "owner";
export const E2E_PASSWORD = "a-long-test-password";
const port = Number(process.env.E2E_PORT ?? 8799);

const env = loadEnv({ MEMEXHUB_SECRET: "e".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-e2e-")) });
// A small sample vault: a folder, a wiki link, a table, a task list, a callout.
const vaultDir = mkdtempSync(join(tmpdir(), "mx-e2ev-"));
mkdirSync(join(vaultDir, "Projects"));
writeFileSync(join(vaultDir, "Projects", "Garden plan.md"), "---\nstatus: active\n---\n# Garden plan\n\nSee [[Seeds]] and [[Missing note]].\n\n- [x] dig\n- [ ] plant\n\n| Bed | Plant |\n|---|---|\n| A | Tomato |\n\n> [!tip] Water\n> In the morning.\n");
writeFileSync(join(vaultDir, "Seeds.md"), "# Seeds\n\nSample seed list.\n");
// Attachments: a 1×1 picture shown in place and a PDF opened by link.
mkdirSync(join(vaultDir, "files"));
writeFileSync(join(vaultDir, "files", "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64"));
writeFileSync(join(vaultDir, "files", "Scan result.pdf"), "%PDF-1.4\n%sample\n");
mkdirSync(join(vaultDir, "raw"));
mkdirSync(join(vaultDir, "wiki"));
writeFileSync(join(vaultDir, "raw", "2026-01-02 Sowing guide.md"), "---\ntitle: Sowing guide\ntype: source\n---\nTomatoes in March.\n");
writeFileSync(join(vaultDir, "wiki", "Tomatoes.md"), "---\ntitle: Tomatoes\nstatus: draft\n---\n# Tomatoes\n\nSow in March ([[2026-01-02 Sowing guide]]).\n");
writeFileSync(join(vaultDir, "Attachments.md"), "# Attachments\n\n![[pixel.png]]\n\nSee [[Scan result.pdf]].\n");
const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} }, vaultHistory: (root) => new GitHistory(join(mkdtempSync(join(tmpdir(), "mx-e2eh-")), "v.git"), root) }, env, MODULES, [testFs(vaultDir), ...PORTABLE_PROVIDERS]);
const log = console.log;
console.log = () => {};
await hub.init();
console.log = log;
await hub.admin.createAdmin(E2E_USER, E2E_PASSWORD, "e2e");
await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "e2e");
await hub.connections.upsert({ kind: "location", provider: "owntracks", name: "phone", config: {} }, "e2e");
await hub.connections.upsert({ kind: "weather", provider: "open-meteo", name: "home", config: { place: "Sample City", latitude: 37.5, longitude: 127 } }, "e2e");
await hub.settings.set("modules", Object.fromEntries(["vault", "wiki", "hub", "ledger", "location", "health"].map((m) => [m, { enabled: true }])));
const s = await hub.settings.get();
await hub.settings.set("vault", { ...s.vault, connection: "vault" });
await hub.settings.set("wiki", { ...s.wiki, preset: "llm-wiki", roles: PRESETS["llm-wiki"]! });
await hub.settings.set("onboarded", true);
// A morning on 2026-01-15 (UTC 03:00–05:00): one stay, a walk, another stay. No map background: no outside calls.
const M0 = Date.parse("2026-01-15T03:00:00Z") / 1000;
for (let i = 0; i < 120; i++) {
  const lat = i < 40 ? 37.5 : i < 70 ? 37.5 + (i - 40) * 0.0004 : 37.512;
  await hub.platform.db.run(`INSERT INTO location_points (t, lat, lon, acc, device) VALUES (?, ?, ?, ?, ?)`, [M0 + i * 60, lat, 127.0, 10, "e2e"]);
}
await hub.settings.set("timezone", "Asia/Seoul");
await hub.reload();
await hub.ingestTokens.create("Sample phone", ["ledger"], "e2e");
// One change through memexhub, so "Seeds" has an earlier version to look at.
await hub.vault!.withActor("claude:e2e").write("Seeds.md", "# Seeds\n\nSample seed list, updated.\n");

const app = new Hono()
  .use("*", (c: any, next: () => Promise<void>) => (c.set("ip", "10.0.0.9"), next()))
  .route("/", ingestApp(hub))
  .route("/admin", adminApp(hub, { vaultRoots: ["/vaults"], builtinVault: "", base: "/admin", assets: nodeAdminAssets() }));
serve({ fetch: app.fetch, port });
console.log(`e2e server on ${port}`);

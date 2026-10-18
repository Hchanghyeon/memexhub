import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type MiddlewareHandler } from "hono";
import { join, resolve } from "node:path";
import { loadEnv } from "./core/config.js";
import { clientIp } from "./core/ip.js";
import { nodePlatform } from "./platform/node.js";
import { Hub } from "./hub.js";
import { MODULES } from "./modules/index.js";
import { fsProvider } from "./storage/fs-provider.js";
import { folderPhotosProvider } from "./providers/photos/folder.js";
import { PORTABLE_PROVIDERS } from "./providers/registry.js";
import { NODE_PROVIDERS } from "./providers/node.js";
import { mcpApp } from "./http/mcp.js";
import { ingestApp } from "./http/ingest.js";
import { adminApp } from "./admin/app.js";
import { bootEnv } from "./platform/env-sources.js";
import { nodeAdminAssets } from "./platform/node-assets.js";

const env = loadEnv(bootEnv(process.env));
const platform = nodePlatform({ dataDir: env.DATA_DIR, secret: env.MEMEXHUB_SECRET });
const builtinVault = resolve(join(env.DATA_DIR, "vault"));
const vaultRoots = env.VAULT_ROOTS.split(",").map((r) => resolve(r.trim())).filter(Boolean);
const trusted = env.TRUSTED_PROXIES.split(",").map((s) => s.trim());

const hub = new Hub(platform, env, MODULES, [...PORTABLE_PROVIDERS, ...NODE_PROVIDERS, fsProvider({ builtinVault, vaultRoots }), folderPhotosProvider({ roots: env.PHOTO_ROOTS.split(",").map((r) => resolve(r.trim())).filter(Boolean) })]);
await hub.init();
const assets = nodeAdminAssets();
// Module jobs (receipt mails, …): check every minute what is due.
setInterval(() => void hub.runDueJobs(), 60_000).unref();

/** Resolve the real client IP once per request (proxy headers trusted only from trusted proxies). */
const withIp: MiddlewareHandler = async (c, next) => {
  const peer = getConnInfo(c).remote.address ?? "";
  c.set("ip" as never, clientIp(peer, c.req.raw.headers, trusted) as never);
  await next();
};

const mount = (sub: Hono<any>) => new Hono().use("*", withIp).route("/", sub);

if (env.LISTEN === "single") {
  const all = new Hono({ strict: false }).use("*", withIp);
  all.route("/admin", adminApp(hub, { vaultRoots, builtinVault, base: "/admin", assets }));
  all.route("/", ingestApp(hub));
  all.route("/", mcpApp(hub));
  serve({ fetch: all.fetch, port: env.SINGLE_PORT });
  platform.log.info("listening", { mode: "single", port: env.SINGLE_PORT });
} else {
  serve({ fetch: mount(mcpApp(hub)).fetch, port: env.MCP_PORT });
  serve({ fetch: mount(ingestApp(hub)).fetch, port: env.INGEST_PORT });
  // The admin web app lives under /admin on its own port too (same paths as LISTEN=single).
  const admin = new Hono({ strict: false }).use("*", withIp).route("/admin", adminApp(hub, { vaultRoots, builtinVault, base: "/admin", assets }));
  admin.get("/", (c) => c.redirect("/admin/"));
  serve({ fetch: admin.fetch, port: env.ADMIN_PORT });
  platform.log.info("listening", { mode: "split", mcp: env.MCP_PORT, ingest: env.INGEST_PORT, admin: env.ADMIN_PORT });
}

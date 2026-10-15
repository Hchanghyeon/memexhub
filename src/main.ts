import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type MiddlewareHandler } from "hono";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv } from "./core/config.js";
import { clientIp } from "./core/ip.js";
import { nodePlatform } from "./platform/node.js";
import { Hub } from "./hub.js";
import { MODULES } from "./modules/index.js";
import { FsStorage } from "./storage/fs.js";
import { portableBuilders } from "./storage/factory.js";
import { StorageError } from "./storage/types.js";
import { mcpApp } from "./http/mcp.js";
import { ingestApp } from "./http/ingest.js";
import { adminApp } from "./admin/app.js";

const env = loadEnv(process.env);
const platform = nodePlatform({ dataDir: env.DATA_DIR, secret: env.MEMEXHUB_SECRET });
const builtinVault = resolve(join(env.DATA_DIR, "vault"));
const vaultRoots = env.VAULT_ROOTS.split(",").map((r) => resolve(r.trim())).filter(Boolean);
const trusted = env.TRUSTED_PROXIES.split(",").map((s) => s.trim());

const hub = new Hub(platform, env, MODULES, {
  ...portableBuilders,
  // A server-local folder may only be the built-in vault or a folder under VAULT_ROOTS.
  fs: (c) => {
    const p = resolve(String(c.config.path ?? ""));
    const ok = p === builtinVault || vaultRoots.some((r) => p === r || p.startsWith(r + "/"));
    if (!ok) throw new StorageError("forbidden", `vault folder must be ${builtinVault} or under ${vaultRoots.join(", ")}`);
    if (p === builtinVault) mkdirSync(p, { recursive: true });
    return new FsStorage(p);
  },
});
await hub.init();

/** Resolve the real client IP once per request (proxy headers trusted only from trusted proxies). */
const withIp: MiddlewareHandler = async (c, next) => {
  const peer = getConnInfo(c).remote.address ?? "";
  c.set("ip" as never, clientIp(peer, c.req.raw.headers, trusted) as never);
  await next();
};

const mount = (sub: Hono<any>) => new Hono().use("*", withIp).route("/", sub);

if (env.LISTEN === "single") {
  const all = new Hono().use("*", withIp);
  all.route("/admin", adminApp(hub, { vaultRoots, builtinVault }));
  all.route("/", ingestApp(hub));
  all.route("/", mcpApp(hub));
  serve({ fetch: all.fetch, port: env.SINGLE_PORT });
  platform.log.info("listening", { mode: "single", port: env.SINGLE_PORT });
} else {
  serve({ fetch: mount(mcpApp(hub)).fetch, port: env.MCP_PORT });
  serve({ fetch: mount(ingestApp(hub)).fetch, port: env.INGEST_PORT });
  serve({ fetch: mount(adminApp(hub, { vaultRoots, builtinVault })).fetch, port: env.ADMIN_PORT });
  platform.log.info("listening", { mode: "split", mcp: env.MCP_PORT, ingest: env.INGEST_PORT, admin: env.ADMIN_PORT });
}

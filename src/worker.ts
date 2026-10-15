import { Hono } from "hono";
import { Hub } from "./hub.js";
import { MODULES } from "./modules/index.js";
import { loadEnv } from "./core/config.js";
import { PORTABLE_PROVIDERS } from "./providers/registry.js";
import { r2Provider } from "./storage/r2.js";
import { workersPlatform, type D1Like } from "./platform/workers.js";
import { adminApp } from "./admin/app.js";
import { ingestApp } from "./http/ingest.js";
import { mcpApp } from "./http/mcp.js";

/**
 * Cloudflare Workers entry: one Worker serves MCP (/mcp, OAuth), ingest (/ingest/*) and the admin UI (/admin).
 * D1 is the database, an R2 bucket can hold the vault, a cron trigger runs the module jobs.
 */
export interface WorkerEnv {
  MEMEXHUB_SECRET: string;
  /** Optional: defaults to the address the Worker is called on (workers.dev or your domain). */
  PUBLIC_URL?: string;
  SETUP_CODE?: string;
  TZ?: string;
  DB: D1Like;
  VAULT?: unknown;
  [binding: string]: unknown;
}

let booted: Promise<{ hub: Hub; app: Hono }> | undefined;

async function boot(env: WorkerEnv, origin: string) {
  const platform = workersPlatform(env);
  const e = loadEnv({ MEMEXHUB_SECRET: env.MEMEXHUB_SECRET, PUBLIC_URL: env.PUBLIC_URL || origin, DATA_DIR: "/", TZ: env.TZ, TRUSTED_PROXIES: "" });
  const hub = new Hub(platform, e, MODULES, [...PORTABLE_PROVIDERS, r2Provider]);
  await hub.init({ setupCode: env.SETUP_CODE });
  const app = new Hono({ strict: false });
  // Cloudflare tells us the caller; nothing in front of it can be trusted more.
  app.use("*", async (c, next) => {
    c.set("ip" as never, (c.req.header("cf-connecting-ip") ?? "0.0.0.0") as never);
    await next();
  });
  app.route("/admin", adminApp(hub, { vaultRoots: [], builtinVault: "", base: "/admin" }));
  app.route("/", ingestApp(hub));
  app.route("/", mcpApp(hub));
  return { hub, app };
}

const ready = (env: WorkerEnv, origin: string) =>
  (booted ??= boot(env, origin).catch((err) => {
    booted = undefined; // try again on the next request
    throw err;
  }));

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
    try {
      const { app } = await ready(env, new URL(request.url).origin);
      return await app.fetch(request, env, ctx as never);
    } catch (err) {
      return new Response(`memexhub could not start: ${(err as Error).message.slice(0, 200)}`, { status: 500, headers: { "content-type": "text/plain" } });
    }
  },
  async scheduled(_event: unknown, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // A cron run before the first request has no origin; it needs PUBLIC_URL or waits for the first visit.
    if (!booted && !env.PUBLIC_URL) return;
    ctx.waitUntil(ready(env, env.PUBLIC_URL ?? "").then(({ hub }) => hub.runDueJobs()));
  },
};

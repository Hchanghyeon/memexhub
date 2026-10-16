import { Hono, type Context } from "hono";
import type { Hub } from "../hub.js";
import { readBodyLimited, rateLimit, securityHeaders } from "./common.js";
import { davRoutes } from "./dav.js";
import { recordAccess } from "../core/access.js";

type Vars = { Variables: { ip: string } };

/**
 * The device token: `X-Ingest-Token`, or the password of HTTP Basic auth for apps that cannot set
 * headers (OwnTracks: Authentication on, any user name, the token as password).
 */
export function ingestToken(c: Context): string {
  const h = c.req.header("x-ingest-token")?.trim();
  if (h) return h;
  const auth = c.req.header("authorization") ?? "";
  if (!/^basic /i.test(auth)) return "";
  try {
    const decoded = atob(auth.slice(6).trim());
    const i = decoded.indexOf(":");
    return i < 0 ? "" : decoded.slice(i + 1).trim();
  } catch {
    return "";
  }
}

/** Ingest surface: phones/apps POST records here with a device token. Write-only: it can add records, never read. */
export function ingestApp(hub: Hub) {
  const app = new Hono<Vars>();
  app.use("*", securityHeaders);
  app.get("/healthz", (c) => c.text("ok"));
  davRoutes(app, hub);
  app.post("/ingest/*", rateLimit(60, (c) => ingestToken(c).slice(0, 12) || c.get("ip")), async (c) => {
    if (!(await hub.admin.hasAdmin())) return c.json({ error: "setup_required" }, 503);
    const route = hub.ingest.find((r) => r.path === c.req.path);
    if (!route) return c.json({ error: "not_found" }, 404);
    const tok = await hub.ingestTokens.verify(ingestToken(c), route.scope);
    await recordAccess(hub.platform.db, { kind: "device", ip: c.get("ip"), ok: !!tok, who: tok?.id, detail: c.req.path }, { now: hub.platform.now(), windowMinutes: tok ? 60 : 10 });
    if (!tok) return c.json({ error: "unauthorized" }, 401);
    const raw = await readBodyLimited(c.req.raw, route.maxBytes);
    if (raw === null) return c.json({ error: "too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    try {
      const result = await route.handle(body, { tokenId: tok.id });
      return c.json((route.reply ? route.reply(result) : { ok: true, ...result }) as object);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message.slice(0, 200) }, 422);
    }
  });
  return app;
}

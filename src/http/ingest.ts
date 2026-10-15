import { Hono } from "hono";
import type { Hub } from "../hub.js";
import { readBodyLimited, rateLimit, securityHeaders } from "./common.js";

type Vars = { Variables: { ip: string } };

/** Ingest surface: phones/apps POST records here with a device token. Write-only: it can add records, never read. */
export function ingestApp(hub: Hub) {
  const app = new Hono<Vars>();
  app.use("*", securityHeaders);
  app.get("/healthz", (c) => c.text("ok"));
  app.post("/ingest/*", rateLimit(60, (c) => c.req.header("x-ingest-token")?.slice(0, 12) ?? c.get("ip")), async (c) => {
    if (!(await hub.admin.hasAdmin())) return c.json({ error: "setup_required" }, 503);
    const route = hub.ingest.find((r) => r.path === c.req.path);
    if (!route) return c.json({ error: "not_found" }, 404);
    const tok = await hub.ingestTokens.verify(c.req.header("x-ingest-token")?.trim() ?? "", route.scope);
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
      return c.json({ ok: true, ...(await route.handle(body, { tokenId: tok.id })) });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message.slice(0, 200) }, 422);
    }
  });
  return app;
}

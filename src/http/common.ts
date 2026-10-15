import type { Context, MiddlewareHandler } from "hono";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
};

/** Tiny fixed-window limiter keyed by caller. In-memory per instance — enough for a single-user server. */
export function rateLimit(perMinute: number, keyOf: (c: Context) => string): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c, next) => {
    const k = keyOf(c);
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) return c.json({ error: "rate_limited" }, 429);
    if (hits.size > 10_000) hits.clear();
    await next();
  };
}

export async function readBodyLimited(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) return null;
  return new TextDecoder().decode(buf);
}

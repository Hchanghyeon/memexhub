import { Hono } from "hono";
import type { Hub } from "../hub.js";
import { inAny, PRIVATE_CIDRS } from "../core/ip.js";
import { securityHeaders } from "../http/common.js";
import { adminApi } from "./api.js";

export { securityChecks, vaultChoice } from "./api.js";

/** Built files of the admin web app (web/ → dist-web/), provided by the runtime entry. */
export interface AdminAssets {
  /** A file by path relative to the app root, e.g. "index.html" or "assets/index-abc.js"; null when missing. */
  file(path: string): Promise<{ body: Uint8Array; type: string } | null>;
}

/** The web app may load its own scripts, styles and fonts and call its own API — nothing else. */
export const APP_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  woff2: "font/woff2", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", json: "application/json", txt: "text/plain; charset=utf-8",
};
export const typeOf = (path: string) => TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream";

/**
 * Admin surface at /admin: the JSON API under /admin/api and the React web app for everything else.
 * Private networks only unless explicitly opened (then two-factor is required — enforced by the API).
 */
export function adminApp(hub: Hub, opts: { vaultRoots: string[]; builtinVault: string; base?: string; assets?: AdminAssets }) {
  const B = (opts.base ?? "/admin").replace(/\/+$/, "");
  const app = new Hono<{ Variables: { ip: string } }>({ strict: false });
  app.use("*", securityHeaders);
  app.use("*", async (c, next) => {
    const s = await hub.settings.get();
    // Cloudflare Workers has no private network: there the admin UI is always reached over the internet (two-factor enforced by the API).
    if (!s.admin.allowPublic && !hub.env.ADMIN_PUBLIC && hub.platform.name !== "workers" && !inAny(c.get("ip"), PRIVATE_CIDRS)) return c.text("admin is only available from your private network", 403);
    await next();
  });
  app.route("/api", adminApi(hub, { vaultRoots: opts.vaultRoots, base: B }));

  // The web app: hashed files are cached for a year, every other path gets index.html (client-side routing).
  app.get("/*", async (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname).slice(B.length).replace(/^\/+/, "");
    if (rel.includes("..") || rel.includes("\\") || rel.length > 200) return c.text("not found", 404);
    const asFile = /\.[a-z0-9]{1,6}$/i.test(rel);
    const f = opts.assets ? await opts.assets.file(asFile ? rel : "index.html") : null;
    if (!f) return asFile ? c.text("not found", 404) : c.text("The admin web app is not built. Run: npm run build:web", 503);
    if (asFile && rel.startsWith("assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
    if (f.type.startsWith("text/html")) c.header("Content-Security-Policy", APP_CSP);
    return c.body(f.body as unknown as ArrayBuffer, 200, { "content-type": f.type });
  });
  return app;
}

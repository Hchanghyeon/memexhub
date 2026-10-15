import { Hono, type Context } from "hono";
import type { Hub } from "../hub.js";
import { StorageError } from "../storage/types.js";
import type { RawEntry } from "../storage/files.js";
import { audit } from "../core/audit.js";
import { rateLimit } from "./common.js";

/**
 * Built-in WebDAV (class 1) at /dav/ for syncing a vault the server holds itself (Remotely Save, other DAV clients).
 * Off by default. Basic auth with a device token of scope "dav". Deletes go to .trash; .trash itself is invisible.
 * Responses are sandboxed (CSP) so a file in the vault can never run as a page on this origin.
 */
const PREFIX = "/dav";
const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", canvas: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", css: "text/css",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "/dav/a%20b/c.md" → "a b/c.md". Refuses traversal, NUL, empty or hidden-trash segments. */
export function davPath(urlPath: string): string | null {
  if (!urlPath.startsWith(PREFIX)) return null;
  let segs: string[];
  try {
    segs = urlPath.slice(PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segs.some((s) => s === "." || s === ".." || s.includes("\0") || s.includes("\\") || s.toLowerCase() === ".trash" || s.length > 255)) return null;
  const p = segs.join("/");
  return p.length > 1024 ? null : p;
}

const href = (p: string, dir: boolean) => `${PREFIX}/${p.split("/").filter(Boolean).map(encodeURIComponent).join("/")}${dir && p ? "/" : ""}`;
function propXml(e: RawEntry) {
  return `<d:response><d:href>${esc(href(e.path, e.dir))}</d:href><d:propstat><d:prop>${e.dir ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:resourcetype/><d:getcontentlength>${e.size}</d:getcontentlength><d:getcontenttype>${TYPES[e.path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream"}</d:getcontenttype>`}<d:getlastmodified>${e.mtime.toUTCString()}</d:getlastmodified>${e.etag ? `<d:getetag>${esc(e.etag)}</d:getetag>` : ""}<d:displayname>${esc(e.path.split("/").pop() ?? "")}</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

async function readBytes(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.byteLength);
  return out;
}

export function davRoutes(app: Hono<any>, hub: Hub) {
  const status = (e: unknown) => (e instanceof StorageError ? ({ not_found: 404, exists: 412, conflict: 409, forbidden: 403, invalid: 400, io: 500 } as const)[e.code] : 500);

  app.use(`${PREFIX}/*`, async (c, next) => {
    c.header("content-security-policy", "sandbox; default-src 'none'");
    c.header("x-content-type-options", "nosniff");
    await next();
  });
  app.use(`${PREFIX}/*`, rateLimit(300, (c) => c.get("ip")));
  app.use(`${PREFIX}/*`, async (c, next) => {
    if (!hub.davFiles) return c.text("WebDAV is off (admin UI → Vault)", 404);
    if (!(await hub.admin.hasAdmin())) return c.text("setup required", 503);
    const auth = c.req.header("authorization") ?? "";
    let token = "";
    if (auth.startsWith("Basic ")) {
      try {
        const dec = atob(auth.slice(6));
        token = dec.slice(dec.indexOf(":") + 1);
      } catch {
        token = "";
      }
    }
    const tok = token ? await hub.ingestTokens.verify(token.trim(), "dav") : null;
    if (!tok) {
      c.header("www-authenticate", 'Basic realm="memexhub vault", charset="UTF-8"');
      return c.text("unauthorized", 401);
    }
    c.set("davActor" as never, `dav:${tok.id}` as never);
    await next();
  });

  const handler = async (c: Context) => {
    const files = hub.davFiles!;
    const actor = c.get("davActor" as never) as string;
    const p = davPath(new URL(c.req.url).pathname);
    if (p === null) return c.text("bad path", 400);
    const m = c.req.method;
    try {
      if (m === "OPTIONS") {
        c.header("dav", "1");
        c.header("allow", "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE");
        return c.body(null, 200);
      }
      if (m === "PROPFIND") {
        const self = p === "" ? { path: "", dir: true, size: 0, mtime: new Date(0) } : await files.stat(p);
        if (!self) return c.text("not found", 404);
        const depth = c.req.header("depth") ?? "1";
        if (depth === "infinity") return c.text("Depth: infinity is not supported", 403);
        const list = [self, ...(self.dir && depth === "1" ? (await files.children(p)).filter((e) => !(p === "" && e.path === ".trash")) : [])];
        return c.body(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${list.map(propXml).join("")}</d:multistatus>`, 207, { "content-type": "application/xml; charset=utf-8" });
      }
      if (m === "GET" || m === "HEAD") {
        const st = await files.stat(p);
        if (!st || st.dir) return c.text("not found", 404);
        if (st.etag && c.req.header("if-none-match") === st.etag) return c.body(null, 304);
        const headers = { "content-type": TYPES[p.split(".").pop()!.toLowerCase()] ?? "application/octet-stream", etag: st.etag ?? "", "last-modified": st.mtime.toUTCString(), "content-length": String(st.size) };
        return m === "HEAD" ? c.body(null, 200, headers) : c.body(await files.read(p), 200, headers);
      }
      if (m === "PUT") {
        if (!p) return c.text("bad path", 400);
        const max = (await hub.settings.get()).dav.maxFileMb * 1024 * 1024;
        const data = await readBytes(c.req.raw, max);
        if (data === null) return c.text("file too large", 413);
        const existed = !!(await files.stat(p));
        const e = await files.write(p, data, { ifMatch: c.req.header("if-match") ?? undefined, ifNoneMatch: c.req.header("if-none-match") === "*" });
        await audit(hub.platform.db, actor, "dav.put", p, { bytes: data.byteLength });
        return c.body(null, existed ? 204 : 201, { etag: e.etag ?? "" });
      }
      if (m === "DELETE") {
        if (!p) return c.text("bad path", 400);
        await files.trash(p);
        await audit(hub.platform.db, actor, "dav.trash", p);
        return c.body(null, 204);
      }
      if (m === "MKCOL") {
        if (!p) return c.text("exists", 405);
        await files.mkdir(p);
        return c.body(null, 201);
      }
      if (m === "MOVE") {
        const dest = c.req.header("destination");
        let to: string | null = null;
        try {
          to = dest ? davPath(new URL(dest, c.req.url).pathname) : null;
        } catch {
          to = null;
        }
        if (!p || !to) return c.text("bad destination", 400);
        const existed = !!(await files.stat(to));
        await files.move(p, to, (c.req.header("overwrite") ?? "T").toUpperCase() !== "F");
        await audit(hub.platform.db, actor, "dav.move", p, { to });
        return c.body(null, existed ? 204 : 201);
      }
      return c.text("method not allowed", 405);
    } catch (e) {
      // A failed If-Match is "precondition failed" in HTTP terms.
      if (e instanceof StorageError && e.code === "conflict" && c.req.header("if-match")) return c.text("changed meanwhile", 412);
      return c.text((e as Error).message.slice(0, 120), status(e));
    }
  };
  app.on(["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "MOVE"], [PREFIX, `${PREFIX}/*`], handler);
}

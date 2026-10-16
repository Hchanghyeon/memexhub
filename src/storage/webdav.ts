import { StorageError, type FileInfo, type VaultStorage } from "./types.js";

export interface WebDavConfig {
  url: string; // base URL of the vault folder, e.g. https://dav.example.com/vault
  username?: string;
  password?: string;
}

/** Vault behind WebDAV (Nextcloud, Synology WebDAV, Remotely Save WebDAV …). Uses only fetch — runs on Node and Workers. */
export class WebDavStorage implements VaultStorage {
  readonly id = "webdav";
  capabilities = { search: false, etag: true };
  private base: string;
  private auth?: string;

  constructor(cfg: WebDavConfig, private fetchFn: typeof fetch = fetch) {
    this.base = cfg.url.replace(/\/+$/, "") + "/";
    if (cfg.username) this.auth = "Basic " + btoa(unescape(encodeURIComponent(`${cfg.username}:${cfg.password ?? ""}`)));
  }

  private url(p: string) {
    return this.base + p.split("/").map(encodeURIComponent).join("/");
  }

  private async req(method: string, p: string, init: { headers?: Record<string, string>; body?: string } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.auth) headers["Authorization"] = this.auth;
    return this.fetchFn(this.url(p), { method, headers, body: init.body, redirect: "manual" });
  }

  async read(p: string) {
    const r = await this.req("GET", p);
    if (r.status === 404) throw new StorageError("not_found", `"${p}" not found`);
    if (!r.ok) throw new StorageError("io", `webdav GET ${r.status}`);
    return { text: await r.text(), etag: r.headers.get("etag") ?? undefined };
  }

  async readBytes(p: string) {
    const r = await this.req("GET", p);
    if (r.status === 404) throw new StorageError("not_found", `"${p}" not found`);
    if (!r.ok) throw new StorageError("io", `webdav GET ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  private async mkcols(p: string) {
    const parts = p.split("/").slice(0, -1);
    let cur = "";
    for (const seg of parts) {
      cur = cur ? `${cur}/${seg}` : seg;
      const r = await this.req("MKCOL", cur + "/");
      if (![201, 405, 301, 200].includes(r.status) && r.status !== 409) throw new StorageError("io", `webdav MKCOL ${r.status}`);
    }
  }

  async write(p: string, text: string, opts: { ifMatch?: string; ifNoneMatch?: "*" } = {}) {
    await this.mkcols(p);
    const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8" };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
    if (opts.ifNoneMatch) headers["If-None-Match"] = "*";
    const r = await this.req("PUT", p, { headers, body: text });
    if (r.status === 412) throw new StorageError(opts.ifNoneMatch ? "exists" : "conflict", "precondition failed");
    if (!r.ok) throw new StorageError("io", `webdav PUT ${r.status}`);
    return { etag: r.headers.get("etag") ?? undefined };
  }

  private async propfind(dir: string): Promise<{ href: string; isDir: boolean; size: number; mtime: Date; etag?: string }[]> {
    const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>`;
    const r = await this.req("PROPFIND", dir ? dir + "/" : "", { headers: { Depth: "1", "Content-Type": "application/xml" }, body });
    if (r.status === 404) return [];
    if (r.status !== 207) throw new StorageError("io", `webdav PROPFIND ${r.status}`);
    const xml = await r.text();
    const out = [];
    for (const m of xml.matchAll(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi)) {
      const block = m[0];
      const tag = (name: string) => block.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, "i"))?.[1]?.trim();
      const href = decodeURIComponent((tag("href") ?? "").replace(/&amp;/g, "&"));
      const isDir = /<(?:\w+:)?collection\b/i.test(block);
      out.push({
        href,
        isDir,
        size: Number(tag("getcontentlength") ?? 0),
        mtime: new Date(tag("getlastmodified") ?? 0),
        etag: tag("getetag")?.replace(/&quot;/g, '"'),
      });
    }
    return out;
  }

  private relFromHref(href: string): string {
    const basePath = decodeURIComponent(new URL(this.base).pathname);
    const path = href.startsWith("http") ? decodeURIComponent(new URL(href).pathname) : href;
    return path.startsWith(basePath) ? path.slice(basePath.length).replace(/\/+$/, "") : path.replace(/^\/+|\/+$/g, "");
  }

  async list(dir = ""): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (d: string, depth: number) => {
      if (depth > 32) return;
      for (const e of await this.propfind(d)) {
        const rel = this.relFromHref(e.href);
        if (rel === d || rel === "") continue;
        if (e.isDir) await walk(rel, depth + 1);
        else out.push({ path: rel, size: e.size, mtime: e.mtime, etag: e.etag });
      }
    };
    await walk(dir, 0);
    return out;
  }

  async stat(p: string): Promise<FileInfo | null> {
    const r = await this.req("HEAD", p);
    if (r.status === 404) return null;
    if (!r.ok) throw new StorageError("io", `webdav HEAD ${r.status}`);
    return {
      path: p,
      size: Number(r.headers.get("content-length") ?? 0),
      mtime: new Date(r.headers.get("last-modified") ?? 0),
      etag: r.headers.get("etag") ?? undefined,
    };
  }

  async move(from: string, to: string) {
    await this.mkcols(to);
    const r = await this.req("MOVE", from, { headers: { Destination: this.url(to), Overwrite: "F" } });
    if (r.status === 412) throw new StorageError("exists", `"${to}" already exists`);
    if (r.status === 404) throw new StorageError("not_found", `"${from}" not found`);
    if (!r.ok) throw new StorageError("io", `webdav MOVE ${r.status}`);
  }
}

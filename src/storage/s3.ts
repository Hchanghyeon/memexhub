import { AwsClient } from "aws4fetch";
import { StorageError, type FileInfo, type VaultStorage } from "./types.js";

export interface S3Config {
  endpoint: string; // https://s3.<region>.amazonaws.com · https://<account>.r2.cloudflarestorage.com · MinIO URL
  region: string; // "auto" for R2
  bucket: string;
  prefix?: string; // folder inside the bucket, e.g. "vault"
  accessKeyId: string;
  secretAccessKey: string;
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

/**
 * Vault in S3-compatible object storage (AWS S3, Cloudflare R2, MinIO). Path-style URLs, SigV4 via aws4fetch,
 * conditional writes with If-Match / If-None-Match. Uses only fetch — runs on Node and Workers.
 */
export class S3Storage implements VaultStorage {
  readonly id = "s3";
  capabilities = { search: false, etag: true };
  private aws: AwsClient;
  private base: string;
  private prefix: string;

  constructor(
    private c: S3Config,
    private f: typeof fetch,
  ) {
    this.aws = new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: c.region || "auto", service: "s3" });
    this.base = `${c.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(c.bucket)}`;
    this.prefix = (c.prefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  private key(p: string) {
    return this.prefix ? `${this.prefix}/${p}` : p;
  }
  private url(key: string) {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  private async send(method: string, url: string, headers: Record<string, string> = {}, body?: string) {
    const signed = await this.aws.sign(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    return this.f(signed.url, { method, headers: Object.fromEntries(signed.headers), ...(body !== undefined ? { body } : {}) });
  }
  private fail(r: Response, what: string): never {
    if (r.status === 404) throw new StorageError("not_found", `${what}: not found`);
    if (r.status === 403 || r.status === 401) throw new StorageError("forbidden", `${what}: access denied by the bucket`);
    throw new StorageError("io", `${what}: HTTP ${r.status}`);
  }

  async read(path: string) {
    const r = await this.send("GET", this.url(this.key(path)));
    if (!r.ok) this.fail(r, path);
    return { text: await r.text(), etag: r.headers.get("etag") ?? undefined };
  }

  async readBytes(path: string) {
    const r = await this.send("GET", this.url(this.key(path)));
    if (!r.ok) this.fail(r, path);
    return new Uint8Array(await r.arrayBuffer());
  }

  async write(path: string, text: string, opts: { ifMatch?: string; ifNoneMatch?: "*" } = {}) {
    const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
    if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
    if (opts.ifNoneMatch) headers["if-none-match"] = "*";
    const r = await this.send("PUT", this.url(this.key(path)), headers, text);
    if (r.status === 412 || r.status === 409) throw new StorageError(opts.ifNoneMatch ? "exists" : "conflict", `${path}: ${opts.ifNoneMatch ? "already exists" : "changed meanwhile"}`);
    if (!r.ok) this.fail(r, path);
    return { etag: r.headers.get("etag") ?? undefined };
  }

  async list(dir = ""): Promise<FileInfo[]> {
    const pfx = this.key(dir ? `${dir.replace(/\/+$/, "")}/` : "");
    const strip = this.prefix ? this.prefix.length + 1 : 0;
    const out: FileInfo[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000", ...(pfx ? { prefix: pfx } : {}), ...(token ? { "continuation-token": token } : {}) });
      const r = await this.send("GET", `${this.base}?${q}`);
      if (!r.ok) this.fail(r, "list");
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = unxml(tag(m[1]!, "Key") ?? "");
        if (!key || key.endsWith("/")) continue;
        out.push({ path: key.slice(strip), size: Number(tag(m[1]!, "Size") ?? 0), mtime: new Date(tag(m[1]!, "LastModified") ?? 0), etag: unxml(tag(m[1]!, "ETag") ?? "") || undefined });
      }
      if (tag(xml, "IsTruncated") !== "true") break;
      token = unxml(tag(xml, "NextContinuationToken") ?? "");
      if (!token) break;
    }
    return out;
  }

  async stat(path: string): Promise<FileInfo | null> {
    const r = await this.send("HEAD", this.url(this.key(path)));
    if (r.status === 404) return null;
    if (!r.ok) this.fail(r, path);
    return { path, size: Number(r.headers.get("content-length") ?? 0), mtime: new Date(r.headers.get("last-modified") ?? 0), etag: r.headers.get("etag") ?? undefined };
  }

  async move(from: string, to: string) {
    if (await this.stat(to)) throw new StorageError("exists", `${to}: already exists`);
    const src = `/${this.c.bucket}/${this.key(from).split("/").map(encodeURIComponent).join("/")}`;
    const r = await this.send("PUT", this.url(this.key(to)), { "x-amz-copy-source": src, "if-none-match": "*" });
    if (r.status === 412) throw new StorageError("exists", `${to}: already exists`);
    if (!r.ok) this.fail(r, from);
    const d = await this.send("DELETE", this.url(this.key(from)));
    if (!d.ok && d.status !== 404) this.fail(d, from);
  }
}

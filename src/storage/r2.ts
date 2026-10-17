import { z } from "zod";
import { defineProvider } from "../providers/types.js";
import { F, T } from "../core/i18n.js";
import { StorageError, type FileInfo, type VaultStorage } from "./types.js";

/** The parts of the R2 binding API we use. */
interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  httpEtag: string;
  text?(): Promise<string>;
}
export interface R2Like {
  get(key: string): Promise<(R2Object & { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  head(key: string): Promise<R2Object | null>;
  put(key: string, value: string, opts?: { onlyIf?: Headers; httpMetadata?: { contentType?: string } }): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
}

/** Vault in an R2 bucket bound to the Worker (no keys needed). Conditional writes through If-Match / If-None-Match. */
export class R2Storage implements VaultStorage {
  readonly id = "r2";
  capabilities = { search: false, etag: true };
  private prefix: string;
  constructor(private b: R2Like, prefix = "") {
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
  }
  private key(p: string) {
    return this.prefix ? `${this.prefix}/${p}` : p;
  }
  async read(path: string) {
    const o = await this.b.get(this.key(path));
    if (!o) throw new StorageError("not_found", `${path}: not found`);
    return { text: await o.text(), etag: o.httpEtag };
  }
  async readBytes(path: string) {
    const o = await this.b.get(this.key(path));
    if (!o) throw new StorageError("not_found", `${path}: not found`);
    return new Uint8Array(await o.arrayBuffer());
  }
  async write(path: string, text: string, opts: { ifMatch?: string; ifNoneMatch?: "*" } = {}) {
    const onlyIf = new Headers();
    if (opts.ifMatch) onlyIf.set("if-match", opts.ifMatch);
    if (opts.ifNoneMatch) onlyIf.set("if-none-match", "*");
    const o = await this.b.put(this.key(path), text, { onlyIf, httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    if (!o) throw new StorageError(opts.ifNoneMatch ? "exists" : "conflict", `${path}: ${opts.ifNoneMatch ? "already exists" : "changed meanwhile"}`);
    return { etag: o.httpEtag };
  }
  async list(dir = ""): Promise<FileInfo[]> {
    const prefix = this.key(dir ? `${dir.replace(/\/+$/, "")}/` : "");
    const strip = this.prefix ? this.prefix.length + 1 : 0;
    const out: FileInfo[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 1000; i++) {
      const r = await this.b.list({ prefix: prefix || undefined, cursor, limit: 1000 });
      for (const o of r.objects) if (!o.key.endsWith("/")) out.push({ path: o.key.slice(strip), size: o.size, mtime: o.uploaded, etag: o.httpEtag });
      if (!r.truncated || !r.cursor) break;
      cursor = r.cursor;
    }
    return out;
  }
  async stat(path: string): Promise<FileInfo | null> {
    const o = await this.b.head(this.key(path));
    return o ? { path, size: o.size, mtime: o.uploaded, etag: o.httpEtag } : null;
  }
  async move(from: string, to: string) {
    const src = await this.b.get(this.key(from));
    if (!src) throw new StorageError("not_found", `${from}: not found`);
    await this.write(to, await src.text(), { ifNoneMatch: "*" });
    await this.b.delete(this.key(from));
  }
}

export const r2Provider = defineProvider({
  kind: "storage",
  id: "r2",
  title: T("Cloudflare R2 bucket (bound to this Worker)", "Cloudflare R2 버킷 (이 Worker에 연결된)"),
  config: z.object({
    binding: z.string().regex(/^[A-Z][A-Z0-9_]{0,40}$/).default("VAULT").meta(F("Binding name", "바인딩 이름", ["The R2 binding name in wrangler.toml. Usually VAULT.", "wrangler.toml 의 R2 바인딩 이름이에요. 보통 VAULT 예요."])),
    prefix: z.string().max(200).optional().meta(F("Folder inside the bucket (optional)", "버킷 안의 폴더 (선택)", ["Empty: the whole bucket is the vault.", "비우면 버킷 전체가 볼트예요."])),
  }),
  runtimes: ["workers"],
  create: ({ config, platform }) => {
    const b = platform.bindings?.[config.binding] as R2Like | undefined;
    if (!b || typeof b.get !== "function") throw new Error(`no R2 binding named ${config.binding}`);
    return new R2Storage(b, config.prefix);
  },
  test: async (s) => {
    await s.list();
  },
});

import type { Db } from "../platform/types.js";
import { audit } from "../core/audit.js";
import { sha256Hex } from "../core/crypto.js";
import { matchesAny, normalizeVaultDir, normalizeVaultPath } from "./paths.js";
import { StorageError, type FileInfo, type VaultStorage } from "./types.js";

export interface VaultPolicy {
  readOnly: boolean;
  protectedPaths: string[];
  maxWriteBytes: number;
  /** Create allowed; overwrite, append, move and trash refused (immutable sources). */
  writeOncePaths?: string[];
}

const TRASH = ".trash";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  pdf: "application/pdf",
};

/**
 * The only way modules touch the vault. Enforces path normalization, protected paths,
 * read-only mode, size limits, trash-instead-of-delete, write-if-changed and auditing.
 */
export class SafeVault {
  constructor(
    private store: VaultStorage,
    private policy: VaultPolicy,
    private db: Db,
    private actor: string,
  ) {}

  withActor(actor: string) {
    return new SafeVault(this.store, this.policy, this.db, actor);
  }

  /**
   * Same vault without protected paths, for actions a human confirmed in the admin UI (e.g. approving a recipe).
   * Never hand this to MCP tools. Read-only mode, write-once sources and size limits still apply.
   */
  confirmedByAdmin(actor = "admin") {
    return new SafeVault(this.store, { ...this.policy, protectedPaths: [] }, this.db, actor);
  }

  private checkNote(path: string): string {
    const p = normalizeVaultPath(path);
    if (!p.toLowerCase().endsWith(".md")) throw new StorageError("invalid", "only .md notes are accessible");
    return p;
  }

  private checkWritable(p: string, op: "create" | "change" = "change") {
    if (this.policy.readOnly) throw new StorageError("forbidden", "the vault is in read-only mode");
    if (matchesAny(p, this.policy.protectedPaths)) {
      // An anomaly signal: tools trying to change rule notes is what a prompt injection would do. hub_status shows it.
      void audit(this.db, this.actor, "vault.protected_write_refused", p).catch(() => {});
      throw new StorageError("forbidden", `"${p}" is protected and can only be changed outside of tools`);
    }
    if (op === "change" && matchesAny(p, this.policy.writeOncePaths ?? []))
      throw new StorageError("forbidden", `"${p}" is a source note — sources are never edited, moved or deleted`);
  }

  async read(path: string) {
    const p = this.checkNote(path);
    return { path: p, ...(await this.store.read(p)) };
  }

  /**
   * A picture or PDF for the read-only viewer. Only these types, never hidden folders, size-capped.
   * Not audited (reading), and not a tool: only the signed-in admin UI reads attachments.
   */
  async readAttachment(path: string): Promise<{ path: string; type: string; bytes: Uint8Array<ArrayBuffer> }> {
    const p = normalizeVaultPath(path);
    if (p.split("/").some((s) => s.startsWith("."))) throw new StorageError("invalid", "hidden files are not shown");
    const type = ATTACHMENT_TYPES[p.slice(p.lastIndexOf(".") + 1).toLowerCase()];
    if (!type) throw new StorageError("invalid", "only pictures and PDFs can be shown");
    if (!this.store.readBytes) throw new StorageError("invalid", "this vault storage cannot show attachments");
    const st = await this.store.stat(p);
    if (!st) throw new StorageError("not_found", `"${p}" not found`);
    if (st.size > MAX_ATTACHMENT_BYTES) throw new StorageError("invalid", `file too large to show (${st.size} bytes)`);
    return { path: p, type, bytes: await this.store.readBytes(p) };
  }

  async list(dir?: string): Promise<FileInfo[]> {
    const d = normalizeVaultDir(dir);
    return (await this.store.list(d)).filter((f) => !f.path.split("/").some((s) => s.startsWith(".")));
  }

  async stat(path: string) {
    return this.store.stat(this.checkNote(path));
  }

  /** Writes only if content changed (avoids sync churn). Returns whether it wrote. */
  async write(path: string, text: string, opts: { overwrite?: boolean; ifMatch?: string } = {}) {
    const p = this.checkNote(path);
    const existing = await this.store.stat(p);
    this.checkWritable(p, existing ? "change" : "create");
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > this.policy.maxWriteBytes) throw new StorageError("invalid", `note too large (${bytes} bytes)`);
    if (existing && opts.overwrite === false) throw new StorageError("exists", `"${p}" already exists`);
    if (existing) {
      const cur = await this.store.read(p);
      if (cur.text === text) return { path: p, created: false, changed: false };
    }
    await this.store.write(p, text, existing ? { ifMatch: opts.ifMatch } : { ifNoneMatch: "*" });
    await audit(this.db, this.actor, existing ? "vault.overwrite" : "vault.create", p, {
      bytes,
      sha: (await sha256Hex(text)).slice(0, 12),
    });
    return { path: p, created: !existing, changed: true };
  }

  async append(path: string, text: string) {
    const p = this.checkNote(path);
    const existing = await this.store.stat(p);
    const cur = existing ? (await this.store.read(p)).text : "";
    const sep = cur === "" || cur.endsWith("\n") ? "" : "\n";
    const r = await this.write(p, cur + sep + text, { overwrite: true });
    return { ...r, created: !existing };
  }

  /** Never deletes: moves into .trash/ with a timestamp. */
  async trash(path: string) {
    const p = this.checkNote(path);
    this.checkWritable(p);
    if (!(await this.store.stat(p))) throw new StorageError("not_found", `"${p}" not found`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = `${TRASH}/${stamp} ${p.replace(/\//g, " - ")}`;
    await this.store.move(p, dest);
    await audit(this.db, this.actor, "vault.trash", p);
    return { path: p, movedTo: dest };
  }

  async move(from: string, to: string) {
    const a = this.checkNote(from);
    const b = this.checkNote(to);
    this.checkWritable(a);
    this.checkWritable(b, "create");
    if (await this.store.stat(b)) throw new StorageError("exists", `"${b}" already exists`);
    await this.store.move(a, b);
    await audit(this.db, this.actor, "vault.move", a, { to: b });
    return { from: a, to: b };
  }

  async search(query: string, opts: { regex?: boolean; caseSensitive?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
    if (query.length > 300) throw new StorageError("invalid", "query too long");
    const re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.caseSensitive ? "" : "i");
    if (this.store.capabilities.search && this.store.search) return this.store.search(re, { limit });
    // Fallback: scan notes (cache/index for remote stores comes later).
    const files = (await this.list()).filter((f) => f.path.endsWith(".md")).sort((x, y) => +y.mtime - +x.mtime);
    const out: { path: string; lines: { n: number; text: string }[] }[] = [];
    for (const f of files) {
      if (out.length >= limit) break;
      const { text } = await this.store.read(f.path);
      const lines = text.split("\n");
      const hits: { n: number; text: string }[] = [];
      lines.forEach((l, i) => {
        if (hits.length < 5 && re.test(l)) hits.push({ n: i + 1, text: l.slice(0, 300) });
      });
      if (hits.length) out.push({ path: f.path, lines: hits });
    }
    return out;
  }
}

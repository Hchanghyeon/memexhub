import { mkdir, readFile, readdir, rename, stat, writeFile, open } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { StorageError, type FileInfo, type VaultStorage } from "./types.js";
import { FsFiles } from "./fs-files.js";

/** Vault in a local folder (also covers Syncthing, iCloud Drive or Obsidian Sync folders on the server). Node only. */
export class FsStorage implements VaultStorage {
  readonly id = "fs";
  capabilities = { search: false, etag: true };
  constructor(private root: string) {}

  files() {
    return new FsFiles(this.root);
  }

  private abs(p: string) {
    const a = join(this.root, p);
    const rel = relative(this.root, a);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) throw new StorageError("forbidden", "outside vault");
    return a;
  }

  private etagOf(size: number, mtime: Date) {
    return createHash("sha1").update(`${size}:${mtime.getTime()}`).digest("hex").slice(0, 16);
  }

  async read(p: string) {
    try {
      const a = this.abs(p);
      const [text, st] = await Promise.all([readFile(a, "utf8"), stat(a)]);
      return { text, etag: this.etagOf(st.size, st.mtime) };
    } catch (e: any) {
      if (e?.code === "ENOENT") throw new StorageError("not_found", `"${p}" not found`);
      throw e instanceof StorageError ? e : new StorageError("io", "read failed");
    }
  }

  async readBytes(p: string) {
    try {
      return new Uint8Array(await readFile(this.abs(p)));
    } catch (e: any) {
      if (e?.code === "ENOENT" || e?.code === "EISDIR") throw new StorageError("not_found", `"${p}" not found`);
      throw e instanceof StorageError ? e : new StorageError("io", "read failed");
    }
  }

  async write(p: string, text: string, opts: { ifMatch?: string; ifNoneMatch?: "*" } = {}) {
    const a = this.abs(p);
    const cur = await this.stat(p);
    if (opts.ifNoneMatch === "*" && cur) throw new StorageError("exists", `"${p}" already exists`);
    if (opts.ifMatch && cur && cur.etag !== opts.ifMatch) throw new StorageError("conflict", "changed since read");
    await mkdir(dirname(a), { recursive: true });
    // Atomic replace: write a temp file next to the target, fsync, rename.
    const tmp = join(dirname(a), `.${randomBytes(6).toString("hex")}.tmp`);
    const fh = await open(tmp, "wx", 0o644);
    try {
      await fh.writeFile(text, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, a);
    const st = await stat(a);
    return { etag: this.etagOf(st.size, st.mtime) };
  }

  async list(dir = ""): Promise<FileInfo[]> {
    const base = this.abs(dir || ".");
    const out: FileInfo[] = [];
    const walk = async (d: string) => {
      let ents;
      try {
        ents = await readdir(d, { withFileTypes: true });
      } catch (e: any) {
        if (e?.code === "ENOENT") return;
        throw e;
      }
      for (const e of ents) {
        const a = join(d, e.name);
        if (e.isDirectory()) await walk(a);
        else if (e.isFile()) {
          const st = await stat(a);
          out.push({ path: relative(this.root, a).split(sep).join("/"), size: st.size, mtime: st.mtime, etag: this.etagOf(st.size, st.mtime) });
        }
      }
    };
    await walk(base);
    return out;
  }

  async stat(p: string): Promise<FileInfo | null> {
    try {
      const st = await stat(this.abs(p));
      if (!st.isFile()) return null;
      return { path: p, size: st.size, mtime: st.mtime, etag: this.etagOf(st.size, st.mtime) };
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  }

  async move(from: string, to: string) {
    if (await this.stat(to)) throw new StorageError("exists", `"${to}" already exists`);
    if (!(await this.stat(from))) throw new StorageError("not_found", `"${from}" not found`);
    await mkdir(dirname(this.abs(to)), { recursive: true });
    await rename(this.abs(from), this.abs(to));
  }
}

export async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
  await writeFile(join(p, ".keep"), "", { flag: "a" });
}

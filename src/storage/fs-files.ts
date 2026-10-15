import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { StorageError } from "./types.js";
import type { RawEntry, RawFiles } from "./files.js";

/**
 * Bytes in a local vault folder. Every path is resolved and checked to stay inside the root,
 * and symbolic links are refused, so a link inside the vault cannot expose the rest of the disk.
 */
export class FsFiles implements RawFiles {
  private realRoot?: string;
  constructor(private root: string) {}

  private async inside(p: string): Promise<string> {
    this.realRoot ??= await realpath(this.root);
    const a = join(this.realRoot, p);
    const rel = relative(this.realRoot, a);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) throw new StorageError("forbidden", "outside vault");
    // Walk the existing part of the path: no component may be a symbolic link.
    let cur = this.realRoot;
    for (const seg of rel.split(sep).filter(Boolean)) {
      cur = join(cur, seg);
      try {
        if ((await lstat(cur)).isSymbolicLink()) throw new StorageError("forbidden", "symbolic links are not followed");
      } catch (e: any) {
        if (e?.code === "ENOENT") break;
        throw e;
      }
    }
    return a;
  }

  private etag(size: number, mtime: Date) {
    return `"${createHash("sha1").update(`${size}:${mtime.getTime()}`).digest("hex").slice(0, 16)}"`;
  }
  private entry(path: string, st: { isDirectory(): boolean; size: number; mtime: Date }): RawEntry {
    const dir = st.isDirectory();
    return { path, dir, size: dir ? 0 : st.size, mtime: st.mtime, ...(dir ? {} : { etag: this.etag(st.size, st.mtime) }) };
  }

  async stat(path: string) {
    try {
      return this.entry(path, await stat(await this.inside(path)));
    } catch (e: any) {
      if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
      throw e;
    }
  }

  async children(dir: string) {
    const a = await this.inside(dir);
    const out: RawEntry[] = [];
    for (const d of await readdir(a, { withFileTypes: true })) {
      if (d.isSymbolicLink() || (!d.isFile() && !d.isDirectory())) continue;
      const p = dir ? `${dir}/${d.name}` : d.name;
      out.push(this.entry(p, await stat(join(a, d.name))));
    }
    return out;
  }

  async read(path: string) {
    const a = await this.inside(path);
    try {
      return new Uint8Array(await readFile(a));
    } catch (e: any) {
      if (e?.code === "ENOENT" || e?.code === "EISDIR") throw new StorageError("not_found", "not found");
      throw e;
    }
  }

  async write(path: string, data: Uint8Array, o: { ifMatch?: string; ifNoneMatch?: boolean } = {}) {
    const a = await this.inside(path);
    const cur = await this.stat(path);
    if (cur?.dir) throw new StorageError("conflict", "a folder has that name");
    if (o.ifNoneMatch && cur) throw new StorageError("exists", "already exists");
    if (o.ifMatch && o.ifMatch !== "*" && cur?.etag !== o.ifMatch) throw new StorageError("conflict", "changed meanwhile");
    await mkdir(dirname(a), { recursive: true });
    await this.inside(path); // the parents we just created must not be links either
    const tmp = join(dirname(a), `.${randomBytes(6).toString("hex")}.tmp`);
    const fh = await open(tmp, "wx", 0o644);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, a);
    return (await this.stat(path))!;
  }

  async mkdir(path: string) {
    const a = await this.inside(path);
    if (await this.stat(path)) throw new StorageError("exists", "already exists");
    await mkdir(a, { recursive: false }).catch((e: any) => {
      throw e?.code === "ENOENT" ? new StorageError("conflict", "parent folder missing") : e;
    });
  }

  async trash(path: string) {
    if (!(await this.stat(path))) throw new StorageError("not_found", "not found");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const to = await this.inside(`.trash/${stamp}/${path}`);
    await mkdir(dirname(to), { recursive: true });
    await rename(await this.inside(path), to);
  }

  async move(from: string, to: string, overwrite: boolean) {
    if (!(await this.stat(from))) throw new StorageError("not_found", "not found");
    const target = await this.stat(to);
    if (target && !overwrite) throw new StorageError("exists", "destination exists");
    if (target) await rm(await this.inside(to), { recursive: true });
    await mkdir(dirname(await this.inside(to)), { recursive: true });
    await rename(await this.inside(from), await this.inside(to));
  }
}

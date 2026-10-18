import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import type { Photo, PhotoSource } from "./types.js";

const IMAGE = new Set(["jpg", "jpeg", "heic", "heif", "png", "webp"]);
const VIDEO = new Set(["mov", "mp4", "m4v"]);
const MAX_SCAN = 200_000;
const MAX_ORIGINAL = 1_500_000;
const ext = (n: string) => n.slice(n.lastIndexOf(".") + 1).toLowerCase();

/**
 * Photos in a folder on this server, read-only. The time a picture was taken is the file's modification time,
 * which phone backups (Synology Photos, Nextcloud, Syncthing) keep. Previews come from thumbnails the photo app
 * already made (Synology: @eaDir/<file>/SYNOPHOTO_THUMB_M.jpg), else from a small JPEG/PNG original; HEIC
 * without a thumbnail has no preview (no image library here).
 */
export class PhotoFolder implements PhotoSource {
  constructor(private root: string) {}

  async list(from: Date, to: Date): Promise<Photo[]> {
    const out: Photo[] = [];
    const lo = from.getTime();
    const hi = to.getTime();
    let scanned = 0;
    // Phone backups sort pictures into year (and month) folders: skip the ones that cannot hold the range.
    // (A folder's own time says nothing here: it changes only when its direct entries do.)
    const years = new Set<number>();
    for (let y = from.getUTCFullYear() - 1; y <= to.getUTCFullYear() + 1; y++) years.add(y);
    const months = new Set<string>();
    for (let t = lo - 32 * 86_400_000; t <= hi + 32 * 86_400_000; t += 86_400_000) { const d = new Date(t); months.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`); }
    const wanted = (full: string) => {
      const parts = relative(this.root, full).split(sep);
      const name = parts[parts.length - 1]!;
      if (/^(19|20)\d\d$/.test(name)) return years.has(Number(name));
      const parent = parts[parts.length - 2];
      if (parent && /^(19|20)\d\d$/.test(parent) && /^(0?[1-9]|1[0-2])$/.test(name)) return months.has(`${Number(parent)}-${Number(name)}`);
      return true;
    };
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (++scanned > MAX_SCAN) return;
        if (e.name.startsWith("@") || e.name.startsWith(".") || e.name.startsWith("#")) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!wanted(full)) continue;
          await walk(full);
          continue;
        }
        const x = ext(e.name);
        if (!IMAGE.has(x) && !VIDEO.has(x)) continue;
        const st = await stat(full).catch(() => undefined);
        if (!st || st.mtimeMs < lo || st.mtimeMs >= hi) continue;
        out.push({ id: relative(this.root, full).split(sep).join("/"), takenAt: new Date(st.mtimeMs).toISOString(), name: e.name, kind: VIDEO.has(x) ? "video" : x === "png" ? "screenshot" : "photo" });
      }
    };
    await walk(this.root);
    return out.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }

  async preview(id: string) {
    const full = resolve(this.root, id);
    if (!full.startsWith(this.root + sep)) return undefined;
    const dir = full.slice(0, full.lastIndexOf(sep));
    const name = full.slice(full.lastIndexOf(sep) + 1);
    for (const thumb of ["SYNOPHOTO_THUMB_M.jpg", "SYNOPHOTO_THUMB_SM.jpg"]) {
      const b = await readFile(join(dir, "@eaDir", name, thumb)).catch(() => undefined);
      if (b) return { bytes: new Uint8Array(b), mimeType: "image/jpeg" };
    }
    const x = ext(name);
    if (x === "jpg" || x === "jpeg" || x === "png") {
      // One open file for the size check and the read, so the file cannot change in between.
      const fh = await open(full, "r").catch(() => undefined);
      if (!fh) return undefined;
      try {
        if ((await fh.stat()).size <= MAX_ORIGINAL) return { bytes: new Uint8Array(await fh.readFile()), mimeType: x === "png" ? "image/png" : "image/jpeg" };
      } finally {
        await fh.close();
      }
    }
    return undefined;
  }
}

/** Node-only: photos in a folder under PHOTO_ROOTS (security boundary), e.g. a Synology Photos mobile backup. */
export function folderPhotosProvider(o: { roots: string[] }) {
  return defineProvider({
    kind: "photos",
    id: "folder",
    title: T("Photo folder on this server (Synology Photos, Nextcloud …)", "이 서버의 사진 폴더 (시놀로지 포토·Nextcloud …)"),
    config: z.object({
      path: z.string().min(1).max(500).meta(F("Folder", "폴더", [
        "A folder under the allowed photo roots (PHOTO_ROOTS, default /photos), e.g. /photos for a Synology Photos mobile backup mounted read-only. Pictures are only read, never changed.",
        "허용된 사진 위치(PHOTO_ROOTS, 기본 /photos) 아래의 폴더예요. 예: 시놀로지 포토 모바일 백업을 읽기 전용으로 붙인 /photos. 사진은 읽기만 하고 바꾸지 않아요.",
      ])),
    }),
    runtimes: ["node"],
    create: ({ config }) => {
      const p = resolve(config.path);
      if (!o.roots.some((r) => p === r || p.startsWith(r + sep))) throw new Error(`the photo folder must be under ${o.roots.join(", ")}`);
      return new PhotoFolder(p);
    },
    test: async (s) => {
      await (s as PhotoFolder).list(new Date(Date.now() - 86_400_000), new Date());
    },
  });
}

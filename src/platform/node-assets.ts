import { readFile, readdir } from "node:fs/promises";
import type { AdminAssets } from "../admin/assets.js";

/** Admin UI assets from the repository's assets/ folder (the Pretendard web font). Missing folder → none. */
export async function nodeAdminAssets(): Promise<AdminAssets | undefined> {
  const dir = new URL("../../assets/fonts/pretendard/", import.meta.url);
  try {
    const css = await readFile(new URL("pretendard.css", dir), "utf8");
    const files = new Set((await readdir(dir)).filter((f) => f.endsWith(".woff2")));
    const cache = new Map<string, Uint8Array>();
    return {
      fontCss: (base) => css.replaceAll("__BASE__", base),
      async font(name) {
        if (!files.has(name)) return null;
        if (!cache.has(name)) cache.set(name, new Uint8Array(await readFile(new URL(name, dir))));
        return cache.get(name)!;
      },
    };
  } catch {
    return undefined;
  }
}

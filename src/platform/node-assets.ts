import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { typeOf, type AdminAssets } from "../admin/app.js";

/** The built admin web app from dist-web/ (next to dist/ in the image, or in the repository). */
export function nodeAdminAssets(dir = fileURLToPath(new URL("../../dist-web/", import.meta.url))): AdminAssets {
  const root = resolve(dir);
  const cache = new Map<string, Uint8Array>();
  return {
    async file(path) {
      const full = resolve(root, path);
      if (!full.startsWith(root + sep)) return null;
      try {
        if (!cache.has(full)) cache.set(full, new Uint8Array(await readFile(full)));
        return { body: cache.get(full)!, type: typeOf(full) };
      } catch {
        return null;
      }
    },
  };
}

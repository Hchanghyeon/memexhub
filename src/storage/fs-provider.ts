import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { defineProvider } from "../providers/types.js";
import { T } from "../core/i18n.js";
import { FsStorage } from "./fs.js";
import { StorageError } from "./types.js";

/** Node-only: a vault folder on this server — the built-in vault or a folder under VAULT_ROOTS (security boundary). */
export function fsProvider(o: { builtinVault: string; vaultRoots: string[] }) {
  return defineProvider({
    kind: "storage",
    id: "fs",
    title: T("Folder on this server", "이 서버의 폴더"),
    config: z.object({ path: z.string().optional().describe("Folder (empty = built-in vault)") }),
    runtimes: ["node"],
    create: ({ config }) => {
      const p = resolve(config.path || o.builtinVault);
      const ok = p === o.builtinVault || o.vaultRoots.some((r) => p === r || p.startsWith(r + "/"));
      if (!ok) throw new StorageError("forbidden", `vault folder must be the built-in vault or under ${o.vaultRoots.join(", ")}`);
      if (p === o.builtinVault) mkdirSync(p, { recursive: true });
      return new FsStorage(p);
    },
    test: async (s) => {
      await s.list();
    },
  });
}

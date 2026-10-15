import { StorageError } from "./types.js";

/** Normalize a user/tool supplied vault path. Rejects anything that could escape the vault. */
export function normalizeVaultPath(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) throw new StorageError("invalid", "invalid path");
  if (input.includes("\0")) throw new StorageError("invalid", "invalid path");
  const p = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new StorageError("forbidden", "path traversal is not allowed");
    if (seg.startsWith(".")) throw new StorageError("forbidden", "hidden files and folders are not accessible");
    parts.push(seg);
  }
  if (parts.length === 0) throw new StorageError("invalid", "empty path");
  return parts.join("/");
}

export function normalizeVaultDir(input: string | undefined): string {
  if (!input) return "";
  return normalizeVaultPath(input);
}

/** Minimal glob: `*` = any chars except `/`, `**` = anything. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

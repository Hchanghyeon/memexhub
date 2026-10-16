import type { SafeVault } from "../../storage/safe-vault.js";
import { normalizeVaultPath } from "../../storage/paths.js";
import { StorageError } from "../../storage/types.js";
import type { Layout } from "./layout.js";
import { parseFrontmatter, parseNote } from "./parse.js";
import { isHub } from "./lint.js";

/** Page lifecycle: Claude writes drafts; the owner confirms (stable); outdated pages are kept as deprecated. */
export const STATUSES = ["draft", "stable", "deprecated"] as const;
export type Status = (typeof STATUSES)[number];

/** Set (or add) one frontmatter key, keeping everything else byte-for-byte. Needs existing frontmatter. */
export function setFrontmatter(text: string, key: string, value: string): string {
  const fm = parseFrontmatter(text);
  if (!fm.present) throw new StorageError("invalid", "the note has no frontmatter");
  const lines = text.split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, "") === "---");
  const at = lines.slice(1, end).findIndex((l) => l.startsWith(`${key}:`));
  if (at >= 0) lines[at + 1] = `${key}: ${value}`;
  else lines.splice(end, 0, `${key}: ${value}`);
  return lines.join("\n");
}

/** What a [[target]] can mean: exact path first, then the file name anywhere (like Obsidian). Notes match without ".md". */
function resolver(paths: string[]) {
  const key = (p: string) => p.replace(/\.md$/i, "").toLowerCase();
  const byPath = new Map(paths.map((p) => [key(p), p]));
  const byName = new Map<string, string>();
  for (const p of [...paths].sort((a, b) => a.length - b.length)) {
    const n = key(p.split("/").pop()!);
    if (!byName.has(n)) byName.set(n, p);
  }
  return (t: string) => {
    const k = key(t.trim().replace(/^\/+/, ""));
    return byPath.get(k) ?? byName.get(k.split("/").pop()!);
  };
}

/**
 * The code half of the wiki harness, run on every wiki page Claude writes (write_note / append_note):
 * - the page needs frontmatter;
 * - it must cite at least one existing source note (when the vault has a sources folder) — fail closed;
 * - it is marked `status: draft` (only the owner, in the admin UI, makes it stable; Claude may deprecate).
 * Pages typed `index`, `area` or `moc` (sub-indexes) only need frontmatter.
 * Broken links do not block (pages are often written in a row) but are reported back.
 */
export async function gateWikiWrite(vault: SafeVault, layout: Layout, path: string, text: string): Promise<{ text: string; notes: string[] }> {
  const p = normalizeVaultPath(path);
  if (!layout.isWikiPage(p)) return { text, notes: [] };
  const fm = parseFrontmatter(text);
  if (!fm.present) throw new StorageError("invalid", `wiki page ${p} needs frontmatter (---) with title, sources and dates — see wiki_layout`);
  // Hub pages that only list other pages (sub-indexes, maps of content) cite no source and carry no status.
  if (isHub(fm.data)) return { text, notes: [] };
  const n = parseNote(text);
  const resolve = resolver((await vault.list()).map((f) => f.path));
  const targets = n.links.map((l) => ({ t: l.target, to: resolve(l.target) }));
  if (layout.sources && !targets.some((x) => x.to && layout.isSource(x.to)))
    throw new StorageError("invalid", `wiki page ${p} cites no existing source note in ${layout.sources}/ — save the original with wiki_save_source and link it ([[…]]) first`);
  const status = fm.data.status === "deprecated" ? "deprecated" : "draft";
  const broken = [...new Set(targets.filter((x) => !x.to && x.t !== p.replace(/\.md$/, "")).map((x) => x.t))];
  return {
    text: setFrontmatter(text, "status", status),
    notes: [`status: ${status}${status === "draft" ? " (the owner confirms it in the admin UI)" : ""}`, ...(broken.length ? [`links to missing notes: ${broken.slice(0, 10).map((b) => `[[${b}]]`).join(", ")}`] : [])],
  };
}

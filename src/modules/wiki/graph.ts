import type { SafeVault } from "../../storage/safe-vault.js";
import { parseNote, type ParsedNote } from "./parse.js";

export interface Note extends ParsedNote {
  path: string;
  bytes: number;
  text: string;
}

const stripMd = (p: string) => p.replace(/\.md$/i, "");
const base = (p: string) => p.split("/").pop()!;

/** Everything a lint pass needs: notes, all file paths, link resolution and backlinks. Built once per call. */
export class LinkGraph {
  notes = new Map<string, Note>();
  private byBase = new Map<string, string[]>(); // lowercased basename (no .md for notes) → paths
  private byPath = new Map<string, string>(); // lowercased path (no .md for notes) → path
  incoming = new Map<string, { from: string; line: number }[]>();

  static async build(vault: SafeVault): Promise<LinkGraph> {
    const g = new LinkGraph();
    const files = await vault.list();
    for (const f of files) {
      const key = f.path.endsWith(".md") ? stripMd(f.path) : f.path;
      g.byPath.set(key.toLowerCase(), f.path);
      const b = (f.path.endsWith(".md") ? stripMd(base(f.path)) : base(f.path)).toLowerCase();
      g.byBase.set(b, [...(g.byBase.get(b) ?? []), f.path]);
    }
    for (const f of files.filter((x) => x.path.endsWith(".md"))) {
      const { text } = await vault.read(f.path);
      g.notes.set(f.path, { path: f.path, bytes: new TextEncoder().encode(text).length, text, ...parseNote(text) });
    }
    for (const n of g.notes.values())
      for (const l of n.links) {
        const to = g.resolve(l.target, n.path);
        if (to && to !== n.path) g.incoming.set(to, [...(g.incoming.get(to) ?? []), { from: n.path, line: l.line }]);
      }
    return g;
  }

  /** Obsidian-style: exact vault path, then path relative to the linking note, then unique-ish basename. */
  resolve(target: string, from: string): string | undefined {
    const t = target.replace(/\\/g, "/").replace(/^\/+/, "");
    const key = (t.toLowerCase().endsWith(".md") ? stripMd(t) : t).toLowerCase();
    if (this.byPath.has(key)) return this.byPath.get(key);
    if (t.includes("/")) {
      const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const rel = (dir ? `${dir}/${key}` : key).toLowerCase();
      return this.byPath.get(rel);
    }
    const cands = this.byBase.get(key);
    if (!cands?.length) return undefined;
    // Prefer the closest one to the linking note (same folder first), like Obsidian.
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    return cands.find((c) => c.startsWith(dir + "/")) ?? cands[0];
  }
}

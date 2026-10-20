import type { LinkGraph, Note } from "./graph.js";
import type { Layout } from "./layout.js";
import { parseNote } from "./parse.js";
import { matchesAny } from "../../storage/paths.js";

/** One reason a note is related, shown to the AI so it can judge. */
export interface Why { signal: string; detail: string; score: number }
export interface Related { path: string; score: number; linked: boolean; why: Why[] }

/** The note asked about: an existing note, or text not saved yet ("where does this belong?"). */
export interface Seed { path?: string; title: string; text: string; tags: string[]; links: string[] }

/**
 * A way to find related notes. Each one scores candidates on its own; the scores add up.
 * The ones here need no model (links, names, tags). A semantic one (embeddings) can be added later as one more.
 */
export interface Signal {
  id: string;
  score(seed: Seed, g: LinkGraph, candidates: Note[]): Map<string, Why>;
}

const titleOf = (n: Note) => String(n.frontmatter.title ?? n.path.split("/").pop()!.replace(/\.md$/i, ""));
const names = (n: Note) => [titleOf(n), ...(Array.isArray(n.frontmatter.aliases) ? n.frontmatter.aliases : n.frontmatter.aliases ? [n.frontmatter.aliases] : [])].map((x) => String(x).trim()).filter((x) => [...x].length >= 3);
const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, "");
const mentions = (text: string, name: string) => text.toLowerCase().includes(name.toLowerCase());

/** Unlinked mentions, both ways: the seed names the note, or the note names the seed (a link waiting to be made). */
export const mentionSignal: Signal = {
  id: "mention",
  score(seed, _g, cands) {
    const out = new Map<string, Why>();
    const seedText = bodyOf(seed.text);
    const seedNames = [seed.title].filter((x) => [...x].length >= 3);
    for (const n of cands) {
      const hit = names(n).find((x) => mentions(seedText, x));
      if (hit) out.set(n.path, { signal: "mention", detail: `"${hit}" appears in this note`, score: 5 });
      else {
        const back = seedNames.find((x) => mentions(bodyOf(n.text), x));
        if (back) out.set(n.path, { signal: "mention", detail: `names "${back}"`, score: 4 });
      }
    }
    return out;
  },
};

/** Shared tags, rarer tags counting more. */
export const tagSignal: Signal = {
  id: "tags",
  score(seed, g, cands) {
    const out = new Map<string, Why>();
    if (!seed.tags.length) return out;
    const freq = new Map<string, number>();
    for (const n of g.notes.values()) for (const t of n.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    for (const n of cands) {
      const shared = n.tags.filter((t) => seed.tags.includes(t));
      if (!shared.length) continue;
      const s = shared.reduce((a, t) => a + 2 / Math.log2(2 + (freq.get(t) ?? 1)), 0);
      out.set(n.path, { signal: "tags", detail: `shares #${shared.slice(0, 3).join(" #")}`, score: Math.round(s * 100) / 100 });
    }
    return out;
  },
};

/**
 * Personalized PageRank over the link graph (links both ways), restarting at the seed and what it links to.
 * Finds notes a few links away that matter to this one (after HippoRAG).
 */
export const graphSignal: Signal = {
  id: "links",
  score(seed, g, cands) {
    const out = new Map<string, Why>();
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (a === b) return;
      (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
    };
    for (const n of g.notes.values()) for (const l of n.links) { const to = g.resolve(l.target, n.path); if (to && g.notes.has(to)) add(n.path, to); }
    const start = [...new Set([...(seed.path ? [seed.path] : []), ...seed.links])].filter((p) => g.notes.has(p));
    if (!start.length) return out;
    const alpha = 0.15;
    let r = new Map(start.map((p) => [p, 1 / start.length]));
    for (let i = 0; i < 30; i++) {
      const next = new Map<string, number>(start.map((p) => [p, alpha / start.length]));
      for (const [u, v] of r) {
        const nb = adj.get(u);
        if (!nb?.size) { for (const p of start) next.set(p, (next.get(p) ?? 0) + ((1 - alpha) * v) / start.length); continue; }
        for (const w of nb) next.set(w, (next.get(w) ?? 0) + ((1 - alpha) * v) / nb.size);
      }
      r = next;
    }
    const keep = new Set(cands.map((c) => c.path));
    const ranked = [...r].filter(([p]) => keep.has(p) && !start.includes(p)).sort((a, b) => b[1] - a[1]);
    const top = ranked[0]?.[1] ?? 0;
    for (const [p, v] of ranked.slice(0, 50)) if (v > 0) out.set(p, { signal: "links", detail: "close in the link graph", score: Math.round((4 * v) / top * 100) / 100 });
    return out;
  },
};

export const SIGNALS: Signal[] = [mentionSignal, tagSignal, graphSignal];

/** Notes related to the seed, best first, with the reasons. Index, log and rule notes are left out. */
export function relatedNotes(g: LinkGraph, layout: Layout, seed: Seed, o: { limit?: number; scope?: "wiki" | "all"; signals?: Signal[] } = {}): Related[] {
  const rules = (p: string) => matchesAny(p, layout.protectedGlobs());
  const cands = [...g.notes.values()].filter((n) => n.path !== seed.path && !layout.isIndex(n.path) && n.path !== layout.roles.log && !rules(n.path) && (o.scope !== "wiki" || layout.isWikiPage(n.path)));
  const linked = new Set(seed.links);
  const total = new Map<string, Related>();
  for (const s of o.signals ?? SIGNALS)
    for (const [p, why] of s.score(seed, g, cands)) {
      const r = total.get(p) ?? { path: p, score: 0, linked: linked.has(p) || !!g.incoming.get(seed.path ?? "")?.some((x) => x.from === p), why: [] };
      r.score += why.score;
      r.why.push(why);
      total.set(p, r);
    }
  return [...total.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, o.limit ?? 10);
}

/** A seed from an existing note, or from text that is not saved yet. */
export function seedOf(g: LinkGraph, input: { path?: string; text?: string; title?: string }): Seed | undefined {
  if (input.path) {
    const n = g.notes.get(input.path);
    if (!n) return undefined;
    return { path: n.path, title: titleOf(n), text: n.text, tags: n.tags, links: n.links.map((l) => g.resolve(l.target, n.path)).filter((x): x is string => !!x) };
  }
  const text = input.text ?? "";
  const p = parseNote(text);
  return { title: input.title ?? String(p.frontmatter.title ?? ""), text, tags: p.tags, links: p.links.map((l) => g.resolve(l.target, "")).filter((x): x is string => !!x) };
}

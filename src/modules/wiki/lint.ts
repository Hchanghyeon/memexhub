import { matchesAny } from "../../storage/paths.js";
import type { Layout } from "./layout.js";
import type { LinkGraph } from "./graph.js";

export interface Finding {
  rule: string;
  path: string;
  line?: number;
  message: string;
}

type Opts = Record<string, unknown>;

/** Strategy: each rule is independent, toggleable and configurable. */
export interface LintRule {
  id: string;
  defaultEnabled: boolean;
  defaults: Opts;
  run(g: LinkGraph, layout: Layout, o: Opts): Finding[];
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : []);
const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);

export const RULES: LintRule[] = [
  {
    id: "broken-links",
    defaultEnabled: true,
    defaults: { ignore: [] as string[] },
    run(g, _l, o) {
      const out: Finding[] = [];
      for (const n of g.notes.values()) {
        if (matchesAny(n.path, arr(o.ignore))) continue;
        for (const l of n.links) if (!g.resolve(l.target, n.path)) out.push({ rule: "broken-links", path: n.path, line: l.line, message: `[[${l.target}]] not found` });
      }
      return out;
    },
  },
  {
    id: "orphans",
    defaultEnabled: true,
    defaults: {},
    run(g, l) {
      return [...g.notes.keys()]
        .filter((p) => l.isWikiPage(p) && !(g.incoming.get(p)?.length))
        .map((p) => ({ rule: "orphans", path: p, message: "no other note links here" }));
    },
  },
  {
    id: "missing-index-entry",
    defaultEnabled: true,
    defaults: {},
    run(g, l) {
      const out: Finding[] = [];
      for (const p of g.notes.keys()) {
        if (!l.isWikiPage(p)) continue;
        const ix = l.indexFor(p);
        if (!ix) continue;
        const index = g.notes.get(ix);
        if (!index) out.push({ rule: "missing-index-entry", path: p, message: `index note ${ix} does not exist` });
        else if (!index.links.some((k) => g.resolve(k.target, ix) === p)) out.push({ rule: "missing-index-entry", path: p, message: `not listed in ${ix}` });
      }
      return out;
    },
  },
  {
    id: "oversized-pages",
    defaultEnabled: true,
    defaults: { maxBytes: 4096 },
    run(g, l, o) {
      const max = num(o.maxBytes, 4096);
      return [...g.notes.values()].filter((n) => l.isWikiPage(n.path) && n.bytes > max).map((n) => ({ rule: "oversized-pages", path: n.path, message: `${n.bytes} bytes > ${max} — split into sub-pages` }));
    },
  },
  {
    id: "index-too-long",
    defaultEnabled: true,
    defaults: { maxEntries: 50 },
    run(g, l, o) {
      const max = num(o.maxEntries, 50);
      return [...g.notes.values()]
        .filter((n) => l.isIndex(n.path))
        .map((n) => ({ n, entries: n.text.split("\n").filter((x) => /^\s*[-*]\s+.*\[\[/.test(x)).length }))
        .filter((x) => x.entries > max)
        .map((x) => ({ rule: "index-too-long", path: x.n.path, message: `${x.entries} entries > ${max} — split into sub-indexes` }));
    },
  },
  {
    id: "frontmatter-required",
    defaultEnabled: false,
    defaults: { keys: ["title", "created", "updated"], scope: "wiki" },
    run(g, l, o) {
      const keys = arr(o.keys);
      const out: Finding[] = [];
      for (const n of g.notes.values()) {
        if (o.scope !== "all" && !l.isWikiPage(n.path)) continue;
        const missing = keys.filter((k) => !(k in n.frontmatter));
        if (missing.length) out.push({ rule: "frontmatter-required", path: n.path, message: n.hasFrontmatter ? `missing: ${missing.join(", ")}` : "no frontmatter" });
      }
      return out;
    },
  },
  {
    id: "unregistered-tags",
    defaultEnabled: false,
    defaults: { allowed: [] as string[] },
    run(g, _l, o) {
      const allowed = new Set(arr(o.allowed));
      if (!allowed.size) return [];
      const out: Finding[] = [];
      for (const n of g.notes.values()) for (const t of n.tags) if (!allowed.has(t)) out.push({ rule: "unregistered-tags", path: n.path, message: `#${t} is not registered` });
      return out;
    },
  },
  {
    id: "wiki-page-without-source",
    defaultEnabled: false,
    defaults: {},
    run(g, l) {
      if (!l.sources) return [];
      return [...g.notes.values()]
        .filter((n) => l.isWikiPage(n.path) && !n.links.some((k) => l.isSource(g.resolve(k.target, n.path) ?? "")))
        .map((n) => ({ rule: "wiki-page-without-source", path: n.path, message: "cites no source note" }));
    },
  },
  {
    id: "page-status",
    defaultEnabled: false,
    defaults: {},
    run(g, l) {
      const ok = ["draft", "stable", "deprecated"];
      return [...g.notes.values()]
        .filter((n) => l.isWikiPage(n.path) && !ok.includes(String(n.frontmatter.status ?? "")))
        .map((n) => ({ rule: "page-status", path: n.path, message: n.frontmatter.status ? `status "${n.frontmatter.status}" is not draft, stable or deprecated` : "no status (draft · stable · deprecated)" }));
    },
  },
  {
    id: "bad-filenames",
    defaultEnabled: true,
    defaults: {},
    run(g) {
      return [...g.notes.keys()].filter((p) => /[\[\]#^|:?*"<>\\]/.test(p.split("/").pop()!)).map((p) => ({ rule: "bad-filenames", path: p, message: "name contains characters that break links or sync ([ ] # ^ | : ? * \" < > \\)" }));
    },
  },
];

export function effectiveRules(cfg: Record<string, { enabled: boolean; options?: Opts }>) {
  return RULES.map((r) => ({ rule: r, enabled: cfg[r.id]?.enabled ?? r.defaultEnabled, options: { ...r.defaults, ...(cfg[r.id]?.options ?? {}) } }));
}

export function lint(g: LinkGraph, layout: Layout, cfg: Record<string, { enabled: boolean; options?: Opts }>, only?: string[]): Finding[] {
  return effectiveRules(cfg)
    .filter((x) => x.enabled && (!only?.length || only.includes(x.rule.id)))
    .flatMap((x) => x.rule.run(g, layout, x.options));
}

export function formatFindings(findings: Finding[], perRule = 20): string {
  if (!findings.length) return "wiki_lint: no findings ✓";
  const by = new Map<string, Finding[]>();
  for (const f of findings) by.set(f.rule, [...(by.get(f.rule) ?? []), f]);
  const head = `wiki_lint: ${findings.length} findings (${[...by].map(([r, fs]) => `${r} ${fs.length}`).join(", ")})`;
  const body = [...by].map(([r, fs]) =>
    [`## ${r} (${fs.length})`, ...fs.slice(0, perRule).map((f) => `- ${f.path}${f.line ? ` L${f.line}` : ""}: ${f.message}`), ...(fs.length > perRule ? [`- … ${fs.length - perRule} more`] : [])].join("\n"),
  );
  return [head, ...body].join("\n\n");
}

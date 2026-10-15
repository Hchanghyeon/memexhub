import { z } from "zod";

/**
 * Vault roles. The engine never assumes folder names — every feature asks the layout where things live.
 * An empty role switches the related feature off.
 */
export const IndexStyle = z.discriminatedUnion("style", [
  z.object({ style: z.literal("folder-note") }), // index of folder X is X/X.md
  z.object({ style: z.literal("index-file"), file: z.string().default("index.md") }), // index of folder X is X/<file>
  z.object({ style: z.literal("none") }),
]);

export const RolesSchema = z.object({
  sources: z.string().optional(), // immutable originals (write-once)
  wiki: z.string().optional(), // LLM-maintained pages ("" = whole vault)
  index: IndexStyle.default({ style: "none" }),
  log: z.string().optional(), // wiki change log note
  daily: z.string().optional(), // pattern, e.g. "Journal/{YYYY-MM-DD}.md"
  rules: z.array(z.string()).default([]), // globs of rule notes — protected from tools
  archive: z.string().optional(),
});
export type Roles = z.infer<typeof RolesSchema>;

export const PRESETS: Record<string, Roles> = {
  "llm-wiki": {
    sources: "raw",
    wiki: "wiki",
    index: { style: "index-file", file: "index.md" },
    log: "wiki/log.md",
    rules: ["CLAUDE.md", "AGENTS.md"],
  },
  para: {
    sources: "Resources/Sources",
    wiki: "Resources/Wiki",
    index: { style: "folder-note" },
    log: "Resources/Wiki/log.md",
    daily: "Journal/{YYYY-MM-DD}.md",
    rules: ["CLAUDE.md", "AGENTS.md", "Templates/**"],
    archive: "Archives",
  },
  "para-ko": {
    sources: "30-자료/원본",
    wiki: "30-자료/위키",
    index: { style: "folder-note" },
    log: "30-자료/위키/로그.md",
    daily: "40-일지/{YYYY-MM-DD}.md",
    rules: ["CLAUDE.md", "AGENTS.md", "_템플릿/**"],
    archive: "90-보관",
  },
  zettelkasten: {
    sources: "sources",
    wiki: "",
    index: { style: "none" },
    rules: ["CLAUDE.md", "AGENTS.md"],
  },
  flat: { wiki: "", index: { style: "none" }, rules: ["CLAUDE.md", "AGENTS.md"] },
};

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, "");

export class Layout {
  constructor(public roles: Roles) {}

  get sources() {
    return this.roles.sources ? trimSlashes(this.roles.sources) : undefined;
  }
  get wiki() {
    return this.roles.wiki === undefined ? undefined : trimSlashes(this.roles.wiki);
  }

  /** Is `path` inside folder `dir`? ("" = whole vault) */
  static within(path: string, dir: string | undefined) {
    if (dir === undefined) return false;
    return dir === "" || path === dir || path.startsWith(dir + "/");
  }

  isSource(p: string) {
    return !!this.sources && Layout.within(p, this.sources);
  }
  isWikiPage(p: string) {
    return Layout.within(p, this.wiki) && !this.isIndex(p) && p !== this.roles.log && !this.isSource(p);
  }

  /** The index note responsible for a page, or undefined if indexes are off. */
  indexFor(page: string): string | undefined {
    const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/")) : "";
    const ix = this.roles.index;
    if (ix.style === "none") return undefined;
    if (ix.style === "index-file") return dir ? `${dir}/${ix.file}` : ix.file;
    if (!dir) return undefined; // root has no folder note
    const name = dir.split("/").pop()!;
    return `${dir}/${name}.md`;
  }

  isIndex(p: string) {
    const ix = this.roles.index;
    if (ix.style === "none") return false;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const base = p.split("/").pop()!;
    if (ix.style === "index-file") return base === ix.file;
    return !!dir && base === `${dir.split("/").pop()}.md`;
  }

  /** Globs for SafeVault. */
  protectedGlobs() {
    return this.roles.rules;
  }
  writeOnceGlobs() {
    return this.sources ? [`${this.sources}/**`] : [];
  }

  describe(): string {
    const r = this.roles;
    const ix = r.index.style === "index-file" ? `index-file (${r.index.file})` : r.index.style;
    return [
      `sources: ${r.sources ?? "(off)"}${r.sources ? " — write-once" : ""}`,
      `wiki: ${r.wiki === undefined ? "(off)" : r.wiki === "" ? "(whole vault)" : r.wiki}`,
      `index: ${ix}`,
      `log: ${r.log ?? "(off)"}`,
      `daily: ${r.daily ?? "(off)"}`,
      `rules (protected): ${r.rules.join(", ") || "(none)"}`,
      `archive: ${r.archive ?? "(off)"}`,
    ].join("\n");
  }
}

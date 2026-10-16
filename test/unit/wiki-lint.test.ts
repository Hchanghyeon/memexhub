import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseFrontmatter, parseNote } from "../../src/modules/wiki/parse.js";
import { LinkGraph } from "../../src/modules/wiki/graph.js";
import { Layout, PRESETS } from "../../src/modules/wiki/layout.js";
import { formatFindings, lint } from "../../src/modules/wiki/lint.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

describe("parse", () => {
  it("reads frontmatter forms", () => {
    const fm = parseFrontmatter(`---\ntitle: "Hello"\ntags: [a, "b"]\naliases:\n  - x\n  - y\n---\nbody`);
    expect(fm.data).toEqual({ title: "Hello", tags: ["a", "b"], aliases: ["x", "y"] });
    expect(parseFrontmatter("no fm").present).toBe(false);
  });
  it("finds links and tags but ignores code", () => {
    const n = parseNote("---\nsources: [\"[[raw/a]]\"]\n---\nSee [[Page|alias]] and ![[img.png]] and [[Other#Heading]].\n`[[not a link]]`\n```\n[[also not]]\n#nottag\n```\n# Heading\nText #real-tag and #2026");
    expect(n.links.map((l) => l.target)).toEqual(["raw/a", "Page", "img.png", "Other"]);
    expect(n.links.find((l) => l.target === "img.png")?.embed).toBe(true);
    expect(n.tags).toEqual(["real-tag"]);
  });
});

describe("wiki_lint on a fixture vault (llm-wiki preset)", () => {
  let g: LinkGraph;
  const layout = new Layout(PRESETS["llm-wiki"]!);
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "mx-lint-"));
    const files: Record<string, string> = {
      "raw/2026-01-01 Article.md": "original text",
      "wiki/index.md": "# Index\n- [[redis]] — cache\n- [[ghost]] — missing page\n",
      "wiki/log.md": "- 2026-01-01 created",
      "wiki/redis.md": "---\ntitle: Redis\n---\nRedis notes. Source: [[2026-01-01 Article]]. See [[ttl]].",
      "wiki/ttl.md": "TTL page, no source, not in index #ttl",
      "wiki/big.md": "x".repeat(5000),
      "wiki/bad#name.md": "bad",
      "notes/daily.md": "links to [[redis]] and [[missing-note]] and ![[pic.png]]",
      "notes/pic.png": "png",
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const db = sqliteDb(":memory:");
    await migrate(db);
    g = await LinkGraph.build(new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t"));
  });

  const run = (cfg: any = {}) => lint(g, layout, cfg);
  const of = (rule: string, cfg: any = {}) => run(cfg).filter((f) => f.rule === rule).map((f) => f.path + (f.line ? `:${f.line}` : "")).sort();

  it("resolves by basename, path and attachments", () => {
    expect(g.resolve("2026-01-01 Article", "wiki/redis.md")).toBe("raw/2026-01-01 Article.md");
    expect(g.resolve("pic.png", "notes/daily.md")).toBe("notes/pic.png");
    expect(g.resolve("wiki/redis", "x.md")).toBe("wiki/redis.md");
  });
  it("broken-links", () => expect(of("broken-links")).toEqual(["notes/daily.md:1", "wiki/index.md:3"]));
  it("orphans (wiki pages only)", () => expect(of("orphans")).toEqual(["wiki/bad#name.md", "wiki/big.md"]));
  it("missing-index-entry", () => expect(of("missing-index-entry")).toEqual(["wiki/bad#name.md", "wiki/big.md", "wiki/ttl.md"]));
  it("oversized-pages with option", () => {
    expect(of("oversized-pages")).toEqual(["wiki/big.md"]);
    expect(of("oversized-pages", { "oversized-pages": { enabled: true, options: { maxBytes: 10 } } })).toContain("wiki/redis.md");
  });
  it("index-too-long", () => expect(of("index-too-long", { "index-too-long": { enabled: true, options: { maxEntries: 1 } } })).toEqual(["wiki/index.md"]));
  it("frontmatter-required is off by default and configurable", () => {
    expect(of("frontmatter-required")).toEqual([]);
    expect(of("frontmatter-required", { "frontmatter-required": { enabled: true, options: { keys: ["title"] } } })).toEqual(["wiki/bad#name.md", "wiki/big.md", "wiki/ttl.md"]);
  });
  it("unregistered-tags", () => expect(of("unregistered-tags", { "unregistered-tags": { enabled: true, options: { allowed: ["other"] } } })).toEqual(["wiki/ttl.md"]));
  it("wiki-page-without-source", () => expect(of("wiki-page-without-source", { "wiki-page-without-source": { enabled: true } })).toEqual(["wiki/bad#name.md", "wiki/big.md", "wiki/ttl.md"]));
  it("bad-filenames", () => expect(of("bad-filenames")).toEqual(["wiki/bad#name.md"]));
  it("formats grouped, capped output", () => {
    const text = formatFindings(run(), 1);
    expect(text).toMatch(/^wiki_lint: \d+ findings/);
    expect(text).toContain("## broken-links (2)");
    expect(text).toContain("… 1 more");
    expect(formatFindings([])).toContain("no findings");
  });
});

describe("sub-indexes (hub pages)", () => {
  let g: LinkGraph;
  const layout = new Layout(PRESETS["llm-wiki"]!);
  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "mx-hub-"));
    const files: Record<string, string> = {
      "raw/s.md": "source",
      "wiki/index.md": "- [[Basics]] — sub-index\n- [[Not a hub]] — plain page\n",
      "wiki/Basics.md": "---\ntype: area\n---\n- [[Deeper]]\n- [[A]]\n" + "- [[A]]\n".repeat(60),
      "wiki/Deeper.md": "---\ntype: moc\n---\n- [[B]]\n- [[Basics]]\n", // links back: a cycle
      "wiki/Not a hub.md": "---\ntype: wiki\nstatus: draft\n---\n[[C]] [[s]]",
      "wiki/A.md": "---\nstatus: draft\n---\nA [[s]]",
      "wiki/B.md": "---\nstatus: draft\n---\nB [[s]]",
      "wiki/C.md": "---\nstatus: draft\n---\nC [[s]]",
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const db = sqliteDb(":memory:");
    await migrate(db);
    g = await LinkGraph.build(new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t"));
  });
  const of = (rule: string) => lint(g, layout, { [rule]: { enabled: true } }, [rule]).map((f) => f.path).sort();

  it("a page listed in a sub-index (two levels down, through a cycle) is listed; one linked from a plain page is not", () => {
    expect(of("missing-index-entry")).toEqual(["wiki/C.md"]);
  });
  it("sub-indexes count for index-too-long, and need no status or source", () => {
    expect(of("index-too-long")).toEqual(["wiki/Basics.md"]);
    expect(of("page-status")).toEqual([]);
    expect(of("wiki-page-without-source")).toEqual([]);
  });
});

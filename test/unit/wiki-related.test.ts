import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LinkGraph } from "../../src/modules/wiki/graph.js";
import { Layout, PRESETS } from "../../src/modules/wiki/layout.js";
import { relatedNotes, seedOf } from "../../src/modules/wiki/related.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

async function graph(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "mx-rel-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  const db = sqliteDb(":memory:");
  await migrate(db);
  return LinkGraph.build(new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t"));
}

const FILES = {
  "CLAUDE.md": "rules mention Sourdough",
  "wiki/index.md": "- [[Sourdough]]\n- [[Starter]]",
  "wiki/Sourdough.md": "---\ntitle: Sourdough\ntags: [baking]\n---\nUses a [[Starter]].",
  "wiki/Starter.md": "---\ntitle: Starter\ntags: [baking]\n---\nFlour and water. See [[Hydration]].",
  "wiki/Hydration.md": "---\ntitle: Hydration\n---\nWater to flour ratio.",
  "wiki/Coffee.md": "---\ntitle: Coffee\ntags: [drinks]\n---\nNothing about bread.",
  "raw/2026-10-15 Article.md": "An article on sourdough bread and hydration.",
};

describe("related notes", () => {
  it("finds notes a few links away, shared tags, and names mentioned without a link", async () => {
    const g = await graph(FILES);
    const layout = new Layout(PRESETS["llm-wiki"]!);
    const r = relatedNotes(g, layout, seedOf(g, { path: "wiki/Sourdough.md" })!);
    const paths = r.map((x) => x.path);
    expect(paths[0]).toBe("wiki/Starter.md"); // linked, same tag, one step
    expect(r[0]!.linked).toBe(true);
    expect(paths).toContain("wiki/Hydration.md"); // two steps away
    expect(r.find((x) => x.path === "raw/2026-10-15 Article.md")?.why.map((w) => w.signal)).toEqual(["mention"]); // names "Sourdough", no link
    expect(paths).not.toContain("wiki/Coffee.md");
    expect(paths).not.toContain("wiki/index.md");
    expect(paths).not.toContain("CLAUDE.md");
  });

  it("works for text not saved yet, and can keep to wiki pages", async () => {
    const g = await graph(FILES);
    const r = relatedNotes(g, new Layout(PRESETS["llm-wiki"]!), seedOf(g, { text: "A note on Hydration levels and my Starter. #baking" })!, { scope: "wiki" });
    expect(r.slice(0, 2).map((x) => x.path).sort()).toEqual(["wiki/Hydration.md", "wiki/Starter.md"]);
    expect(r.every((x) => x.path.startsWith("wiki/"))).toBe(true);
  });
});

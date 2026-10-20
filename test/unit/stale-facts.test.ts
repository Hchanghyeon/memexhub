import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LinkGraph } from "../../src/modules/wiki/graph.js";
import { Layout, PRESETS } from "../../src/modules/wiki/layout.js";
import { lint } from "../../src/modules/wiki/lint.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

const NOW = Date.parse("2026-10-20T00:00:00Z");

async function graph(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "mx-stale-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  const db = sqliteDb(":memory:");
  await migrate(db);
  return LinkGraph.build(new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t"));
}

describe("stale facts: pages to confirm again", () => {
  it("lists opted-in pages not confirmed for a while, oldest first", async () => {
    const g = await graph({
      "jobs.md": "---\nupdated: 2026-09-27\ntags: [status/active]\n---\napplications",
      "health.md": "---\nupdated: 2026-01-01\nreview: 90\n---\nplan",
      "fresh.md": "---\nupdated: 2026-01-01\nchecked: 2026-10-15\nreview: 30\n---\nok",
      "plain.md": "---\nupdated: 2020-01-01\n---\nnot opted in",
      "never.md": "---\nreview: 7\n---\nno date",
    });
    const f = lint(g, new Layout(PRESETS.flat!), { "stale-facts": { enabled: true, options: { tags: ["status/active"], days: 14, now: NOW } } }, ["stale-facts"]);
    expect(f.map((x) => x.path)).toEqual(["never.md", "health.md", "jobs.md"]);
    expect(f[2]!.message).toBe("last confirmed 2026-09-27 (23 days, every 14): still true?");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layout, PRESETS } from "../../src/modules/wiki/layout.js";
import { addToIndex, appendLog, backlinks, safeTitle, saveSource, today } from "../../src/modules/wiki/upkeep.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import wiki from "../../src/modules/wiki/index.js";
import { SettingsSchema } from "../../src/core/settings.js";

let v: SafeVault;
const L = new Layout(PRESETS["llm-wiki"]!);
const F = new Layout(PRESETS.para!);
beforeEach(async () => {
  const db = sqliteDb(":memory:");
  await migrate(db);
  v = new SafeVault(new FsStorage(mkdtempSync(join(tmpdir(), "mx-up-"))), { readOnly: false, protectedPaths: L.protectedGlobs(), writeOncePaths: L.writeOnceGlobs(), maxWriteBytes: 1e6 }, db, "t");
});

describe("wiki upkeep", () => {
  it("dates and titles", () => {
    expect(today("Asia/Seoul", new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-02");
    expect(safeTitle("A [weird]: title/#1?")).toBe("A weird title 1");
  });

  it("saves sources unchanged, merges frontmatter, never overwrites", async () => {
    const p = await saveSource(v, L, { title: "My Article", content: "body *as is*", url: "https://example.com/a", date: "2026-01-02" });
    expect(p).toBe("raw/2026-01-02 My Article.md");
    const t = (await v.read(p)).text;
    expect(t).toContain('title: "My Article"');
    expect(t).toContain('source: "https://example.com/a"');
    expect(t.endsWith("body *as is*")).toBe(true);
    await expect(saveSource(v, L, { title: "My Article", content: "again", date: "2026-01-02" })).rejects.toMatchObject({ code: "forbidden" });
    const p2 = await saveSource(v, L, { title: "Has FM", content: "---\ntitle: kept\ntags: [x]\n---\nbody", date: "2026-01-02" });
    const t2 = (await v.read(p2)).text;
    expect(t2).toContain("title: kept");
    expect(t2).not.toContain('title: "Has FM"');
    expect(t2).toContain("created: 2026-01-02");
    expect(t2.endsWith("---\nbody")).toBe(true);
    await expect(saveSource(v, L, { title: "x", content: "y", url: "javascript:alert(1)", date: "2026-01-02" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("appends to the log", async () => {
    await appendLog(v, L, "first", "2026-01-02");
    await appendLog(v, L, "second\nline", "2026-01-03");
    expect((await v.read("wiki/log.md")).text).toBe("# Log\n\n- 2026-01-02 first\n- 2026-01-03 second line\n");
  });

  it("adds index entries once, under sections, for both styles", async () => {
    await v.write("wiki/redis.md", "redis");
    await v.write("wiki/ttl.md", "ttl");
    expect((await addToIndex(v, L, { path: "wiki/redis.md", description: "cache" })).index).toBe("wiki/index.md");
    expect((await addToIndex(v, L, { path: "wiki/redis.md", description: "cache" })).added).toBe(false);
    await addToIndex(v, L, { path: "wiki/ttl.md", description: "expiry", section: "Redis" });
    expect((await v.read("wiki/index.md")).text).toBe("# wiki\n- [[redis]]: cache\n\n## Redis\n\n- [[ttl]]: expiry\n");
    await v.write("Resources/Wiki/Topic.md", "t");
    expect((await addToIndex(v, F, { path: "Resources/Wiki/Topic.md", description: "x" })).index).toBe("Resources/Wiki/Wiki.md");
    await expect(addToIndex(v, L, { path: "wiki/missing.md", description: "x" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists backlinks", async () => {
    await v.write("wiki/a.md", "see [[b]]");
    await v.write("wiki/b.md", "b");
    expect(await backlinks(v, "wiki/b.md")).toEqual([{ from: "wiki/a.md", line: 1, text: "see [[b]]" }]);
    expect(await backlinks(v, "b")).toHaveLength(1);
  });

  it("hides tools whose role is not configured", async () => {
    const names = async (roles: any) =>
      ((await wiki.setup({ settings: SettingsSchema.parse({ wiki: { roles } }), vault: v } as any)).tools ?? []).map((t) => t.name).sort();
    expect(await names(PRESETS["llm-wiki"])).toEqual(["conversation_save", "wiki_backlinks", "wiki_check", "wiki_index", "wiki_layout", "wiki_lint", "wiki_log", "wiki_pending", "wiki_review", "wiki_save_source", "wiki_checked"].sort());
    expect(await names(PRESETS.flat)).toEqual(["wiki_backlinks", "wiki_check", "wiki_checked", "wiki_layout", "wiki_lint", "wiki_review"]);
  });
});

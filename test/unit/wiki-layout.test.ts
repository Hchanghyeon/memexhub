import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layout, PRESETS, RolesSchema } from "../../src/modules/wiki/layout.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

describe("Layout", () => {
  it("resolves index notes per style", () => {
    const folder = new Layout(PRESETS.para!);
    expect(folder.indexFor("Resources/Wiki/Redis.md")).toBe("Resources/Wiki/Wiki.md");
    expect(folder.isIndex("Resources/Wiki/Wiki.md")).toBe(true);
    expect(folder.indexFor("Top.md")).toBeUndefined();
    const file = new Layout(PRESETS["llm-wiki"]!);
    expect(file.indexFor("wiki/redis.md")).toBe("wiki/index.md");
    expect(file.isIndex("wiki/index.md")).toBe(true);
    expect(new Layout(PRESETS.flat!).indexFor("a/b.md")).toBeUndefined();
  });

  it("classifies wiki pages, sources, log and index", () => {
    const l = new Layout(PRESETS["llm-wiki"]!);
    expect(l.isWikiPage("wiki/redis.md")).toBe(true);
    expect(l.isWikiPage("wiki/index.md")).toBe(false);
    expect(l.isWikiPage("wiki/log.md")).toBe(false);
    expect(l.isWikiPage("raw/2026-01-01 article.md")).toBe(false);
    expect(l.isSource("raw/2026-01-01 article.md")).toBe(true);
    const whole = new Layout(PRESETS.zettelkasten!);
    expect(whole.isWikiPage("any/note.md")).toBe(true);
    expect(whole.isWikiPage("sources/x.md")).toBe(false);
  });

  it("presets validate and empty roles mean off", () => {
    for (const p of Object.values(PRESETS)) expect(RolesSchema.safeParse(p).success).toBe(true);
    const off = new Layout(RolesSchema.parse({}));
    expect(off.writeOnceGlobs()).toEqual([]);
    expect(off.isWikiPage("x.md")).toBe(false);
    expect(off.describe()).toContain("sources: (off)");
  });
});

describe("SafeVault with layout", () => {
  it("makes sources write-once and rule notes protected", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    const l = new Layout(PRESETS["llm-wiki"]!);
    const v = new SafeVault(
      new FsStorage(mkdtempSync(join(tmpdir(), "mx-layout-"))),
      { readOnly: false, protectedPaths: l.protectedGlobs(), writeOncePaths: l.writeOnceGlobs(), maxWriteBytes: 10_000 },
      db,
      "test",
    );
    await v.write("raw/2026-01-01 a.md", "original");
    await expect(v.write("raw/2026-01-01 a.md", "edited")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.append("raw/2026-01-01 a.md", "more")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.trash("raw/2026-01-01 a.md")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.move("raw/2026-01-01 a.md", "wiki/a.md")).rejects.toMatchObject({ code: "forbidden" });
    await v.write("wiki/a.md", "page");
    await v.move("wiki/a.md", "raw/2026-01-02 moved-in.md"); // moving a new file into sources is a create
    expect((await v.read("raw/2026-01-01 a.md")).text).toBe("original");
    await expect(v.write("CLAUDE.md", "x")).rejects.toMatchObject({ code: "forbidden" });
  });
});

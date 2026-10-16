import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fields, SearchIndex, terms } from "../../src/storage/search-index.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { exportBackup } from "../../src/core/backup.js";
import { decrypt } from "../../src/core/crypto.js";
import type { Db } from "../../src/platform/types.js";

let root: string, db: Db, v: SafeVault;
const write = (p: string, text: string) => {
  mkdirSync(join(root, p, ".."), { recursive: true });
  writeFileSync(join(root, p), text);
};
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mx-si-"));
  db = sqliteDb(":memory:");
  await migrate(db);
  write("wiki/JDBC와 커넥션 풀.md", "---\ntitle: JDBC와 커넥션 풀\naliases: [HikariCP, DataSource]\n---\n\n> 커넥션을 미리 만들어 풀에 둔다.\n\n## 본문\n커넥션 풀은 서버당 최대 커넥션 수를 제한한다.\n");
  write("journal/2026-10-16.md", "오늘 커넥션 이야기를 잠깐 했다.\nDB 백업도 확인.\n");
  write("notes/other.md", "nothing here about it\n");
  write(".obsidian/hidden.md", "커넥션 hidden");
  v = new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t", { index: new SearchIndex(db), source: "fs:vault" });
});

describe("search index", () => {
  it("pulls title, aliases, summary and body out of a note", () => {
    const f = fields("a/B.md", "---\ntitle: T\naliases:\n  - x\n  - y\n---\n# H\n> one\n> two\n\nbody");
    expect(f).toMatchObject({ title: "T", aliases: "x y", summary: "one two", bodyLine: 7 });
    expect(fields("a/B.md", "plain first line\nsecond").title).toBe("B");
    expect(terms('커넥션 "풀 크기" NEAR(a b) *')).toEqual(["커넥션", "풀 크기", "NEAR(a", "b)", "*"]);
  });

  it("answers only after the first build; then finds Korean words with particles, best match first, with line numbers", async () => {
    expect(await new SearchIndex(db).search("커넥션", 10)).toBeUndefined();
    expect(await v.reindex()).toEqual({ changed: 3, removed: 0 });
    const hits = await v.search("커넥션", { limit: 10 });
    expect(hits.map((h) => h.path)).toEqual(["wiki/JDBC와 커넥션 풀.md", "journal/2026-10-16.md"]); // title first; hidden folder never
    expect(hits[0]!.lines[0]).toEqual({ n: 6, text: "> 커넥션을 미리 만들어 풀에 둔다." });
    expect((await v.search("hikaricp", { limit: 10 })).map((h) => h.path)).toEqual(["wiki/JDBC와 커넥션 풀.md"]); // alias, any case
  });

  it("needs every word, keeps quoted phrases, handles short words and FTS syntax safely", async () => {
    await v.reindex();
    expect((await v.search("커넥션 서버당", { limit: 10 })).map((h) => h.path)).toEqual(["wiki/JDBC와 커넥션 풀.md"]);
    expect(await v.search('"풀 크기"', { limit: 10 })).toEqual([]);
    expect((await v.search("DB", { limit: 10 })).map((h) => h.path).sort()).toEqual(["journal/2026-10-16.md", "wiki/JDBC와 커넥션 풀.md"]); // 2 letters: LIKE, inside words too
    for (const q of ['"', "*", "NEAR(a b)", "a OR b", "-x", "100%"]) await expect(v.search(q, { limit: 10 })).resolves.toBeDefined();
  });

  it("follows writes through memexhub at once, and outside edits and deletions on the next reconcile", async () => {
    await v.reindex();
    await v.write("notes/new.md", "트랜잭션 격리 수준");
    expect((await v.search("격리 수준", { limit: 5 })).map((h) => h.path)).toEqual(["notes/new.md"]);
    await v.move("notes/new.md", "notes/moved.md");
    expect((await v.search("격리 수준", { limit: 5 })).map((h) => h.path)).toEqual(["notes/moved.md"]);
    write("notes/other.md", "이제 체크포인트 이야기");
    utimesSync(join(root, "notes/other.md"), new Date(), new Date(Date.now() + 5000));
    unlinkSync(join(root, "journal/2026-10-16.md"));
    expect(await v.search("체크포인트", { limit: 5 })).toEqual([]); // not yet
    expect(await v.reindex()).toEqual({ changed: 1, removed: 1 });
    expect((await v.search("체크포인트", { limit: 5 })).map((h) => h.path)).toEqual(["notes/other.md"]);
    expect((await v.search("커넥션", { limit: 5 })).map((h) => h.path)).toEqual(["wiki/JDBC와 커넥션 풀.md"]);
    expect((await v.searchIndexStats()).notes).toBe(3);
  });

  it("keeps regex and case-sensitive search exact (scanning)", async () => {
    await v.reindex();
    expect((await v.search("커넥션.*제한", { regex: true, limit: 5 })).map((h) => h.path)).toEqual(["wiki/JDBC와 커넥션 풀.md"]);
    expect(await v.search("hikaricp", { caseSensitive: true, limit: 5 })).toEqual([]);
  });

  it("falls back to scanning where FTS5 is missing", async () => {
    const noFts: Db = { ...db, run: (sql: string, p?: unknown[]) => (/VIRTUAL TABLE/.test(sql) ? Promise.reject(new Error("no such module: fts5")) : db.run(sql, p)) };
    const v2 = new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, noFts, "t", { index: new SearchIndex(noFts), source: "fs:vault" });
    expect(await v2.reindex()).toEqual({ changed: 0, removed: 0 });
    expect((await v2.search("커넥션", { limit: 5 })).length).toBe(2);
    expect(await v2.searchIndexStats()).toEqual({ available: false, ready: false, notes: 0, updated: null });
  });

  it("a different vault starts a fresh index, and backups leave the index out", async () => {
    await v.reindex();
    const other = mkdtempSync(join(tmpdir(), "mx-si2-"));
    writeFileSync(join(other, "x.md"), "완전히 다른 볼트");
    const v3 = new SafeVault(new FsStorage(other), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t", { index: new SearchIndex(db), source: "fs:other" });
    await v3.reindex();
    expect((await v3.search("커넥션", { limit: 5 })).length).toBe(0);
    const blob = await exportBackup(db, "k".repeat(48));
    const json = await decrypt("k".repeat(48), "backup", blob.trim().split("\n")[1]!, "memexhub-backup-v1");
    expect(Object.keys(JSON.parse(json).tables).filter((t) => t.startsWith("vault_search") || t === "map_tiles")).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fields, noteDays, SearchIndex, terms } from "../../src/storage/search-index.js";
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

describe("searching by date", () => {
  it("dates a note by its path, else by its frontmatter", () => {
    expect(noteDays("40-일지/2026/10/2026-10-19.md", "x")).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(noteDays("40-일지/결제/2026-10.md", "x")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(noteDays("wiki/a.md", "---\ncreated: 2024-03-02\nupdated: 2024-05-01\n---\n")).toEqual({ from: "2024-03-02", to: "2024-05-01" });
    expect(noteDays("wiki/b.md", "no frontmatter")).toBeUndefined();
  });

  it("keeps notes of the period, with the index and without it", async () => {
    write("wiki/old.md", "---\ncreated: 2024-09-01\n---\n커넥션 예전 이야기\n");
    await v.reindex();
    const paths = async (vault: SafeVault, q: string, o: { since?: string; until?: string }) => (await vault.search(q, { limit: 20, ...o })).map((h) => h.path).sort();
    expect(await paths(v, "커넥션", { since: "2026-10-01", until: "2026-10-31" })).toEqual(["journal/2026-10-16.md"]);
    expect(await paths(v, "커넥션", { until: "2024-12-31" })).toEqual(["wiki/old.md"]);
    expect(await paths(v, "", { since: "2026-10-16", until: "2026-10-16" })).toEqual(["journal/2026-10-16.md"]); // no words: the notes of that day
    const plain = new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: [], maxWriteBytes: 1e6 }, db, "t"); // no index: scanning
    expect(await paths(plain, "커넥션", { since: "2026-10-01" })).toEqual(["journal/2026-10-16.md"]);
  });

  it("rebuilds an index made before dates existed", async () => {
    const old = sqliteDb(":memory:");
    await old.run(`CREATE VIRTUAL TABLE vault_search USING fts5(path UNINDEXED, title, aliases, summary, body, tokenize = 'trigram')`);
    await old.run(`CREATE TABLE vault_search_files (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, sig TEXT NOT NULL, mtime TEXT NOT NULL, body_line INTEGER NOT NULL)`);
    await old.run(`CREATE TABLE vault_search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await old.run(`INSERT INTO vault_search_meta (key, value) VALUES ('ready', '1')`);
    const ix = new SearchIndex(old);
    expect(await ix.search("x", 5)).toBeUndefined(); // emptied: not ready until rebuilt
    expect((await old.all<{ name: string }>(`PRAGMA table_info(vault_search_files)`)).map((c) => c.name)).toContain("day_from");
  });
});

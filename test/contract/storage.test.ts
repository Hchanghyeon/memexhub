import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsStorage } from "../../src/storage/fs.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import type { VaultStorage } from "../../src/storage/types.js";
import { S3Storage } from "../../src/storage/s3.js";
import { fakeNotionApi, fakeR2, fakeS3 } from "../helpers.js";
import { NotionVault } from "../../src/providers/notion/vault.js";
import { NotionClient } from "../../src/providers/notion/client.js";
import { R2Storage } from "../../src/storage/r2.js";

/** Contract every storage adapter must pass. Add new adapters to `adapters`. */
const adapters: Record<string, () => VaultStorage> = {
  fs: () => new FsStorage(mkdtempSync(join(tmpdir(), "mx-fs-"))),
  r2: () => new R2Storage(fakeR2(), "vault"),
  notion: () => {
    const mem = new Map<string, unknown>();
    const cursors = { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => void mem.set(k, v) } as any;
    const client = new NotionClient({ token: "t".repeat(30), version: "2025-09-03", parentPage: "0123456789abcdef0123456789abcdef" }, fakeNotionApi().fetch, async () => {});
    return new NotionVault(client, cursors, "k");
  },
  s3: () => new S3Storage({ endpoint: "https://s3.example.com", region: "auto", bucket: "vault-bucket", prefix: "my vault", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" }, fakeS3().fetch),
};

for (const [name, make] of Object.entries(adapters)) {
  describe(`storage contract: ${name}`, () => {
    let s: VaultStorage;
    beforeEach(() => {
      s = make();
    });
    it("writes, reads, lists, stats", async () => {
      await s.write("a/b/note.md", "hello", { ifNoneMatch: "*" });
      expect((await s.read("a/b/note.md")).text).toBe("hello");
      expect((await s.list()).map((f) => f.path)).toContain("a/b/note.md");
      expect((await s.stat("a/b/note.md"))?.size).toBe(5);
      expect(await s.stat("missing.md")).toBeNull();
    });
    it("refuses create-if-absent on existing and detects conflicts", async () => {
      await s.write("n.md", "1");
      await expect(s.write("n.md", "2", { ifNoneMatch: "*" })).rejects.toMatchObject({ code: "exists" });
      await expect(s.write("n.md", "2", { ifMatch: "stale" })).rejects.toMatchObject({ code: "conflict" });
    });
    it("lists across pages and inside a folder", async () => {
      for (const p of ["d/1.md", "d/2.md", "d/sub/3.md", "e/4.md", "a & b.md"]) await s.write(p, p);
      expect((await s.list()).map((f) => f.path).sort()).toEqual(["a & b.md", "d/1.md", "d/2.md", "d/sub/3.md", "e/4.md"]);
      expect((await s.list("d")).map((f) => f.path).sort()).toEqual(["d/1.md", "d/2.md", "d/sub/3.md"]);
    });
    it("keeps a whole note exactly", async () => {
      const note = "---\ntitle: x\n---\n\n# H\n- a\n- [ ] b\n1. c\n```js\nlet a = 1;\n```\n> q\n**bold** text\n";
      await s.write("n/full.md", note);
      expect((await s.read("n/full.md")).text).toBe(note);
      await s.write("n/full.md", note.replace("# H", "# H2"));
      expect((await s.read("n/full.md")).text).toBe(note.replace("# H", "# H2"));
    });
    it("reads raw bytes when it can, and says not_found for missing files", async () => {
      if (!s.readBytes) return; // optional: such a store shows no attachments in the viewer
      await s.write("pics/한글 a.md", "bytes ✓");
      expect(new TextDecoder().decode(await s.readBytes("pics/한글 a.md"))).toBe("bytes ✓");
      await expect(s.readBytes("pics/missing.png")).rejects.toMatchObject({ code: "not_found" });
    });
    it("moves without overwriting", async () => {
      await s.write("x.md", "x");
      await s.write("y.md", "y");
      await expect(s.move("x.md", "y.md")).rejects.toMatchObject({ code: "exists" });
      await s.move("x.md", "z/x.md");
      expect((await s.read("z/x.md")).text).toBe("x");
    });
  });
}

describe("SafeVault policy", () => {
  let v: SafeVault;
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "mx-safe-"));
    const db = sqliteDb(":memory:");
    await migrate(db);
    v = new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: ["CLAUDE.md", "rules/**"], maxWriteBytes: 100 }, db, "test");
  });
  it("blocks traversal, hidden paths and non-notes", async () => {
    await expect(v.read("../etc/passwd.md")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.write(".obsidian/x.md", "x")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.write("a/../../x.md", "x")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.write("img.png", "x")).rejects.toMatchObject({ code: "invalid" });
  });
  it("protects rule notes", async () => {
    await expect(v.write("CLAUDE.md", "evil")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.append("rules/nightly.md", "evil")).rejects.toMatchObject({ code: "forbidden" });
    await expect(v.move("ok.md", "rules/x.md")).rejects.toThrow();
  });
  it("limits size and skips unchanged writes", async () => {
    await expect(v.write("big.md", "x".repeat(101))).rejects.toMatchObject({ code: "invalid" });
    expect((await v.write("n.md", "same")).changed).toBe(true);
    expect((await v.write("n.md", "same")).changed).toBe(false);
  });
  it("trashes instead of deleting and hides trash from listings", async () => {
    await v.write("gone.md", "bye");
    const r = await v.trash("gone.md");
    expect(r.movedTo.startsWith(".trash/")).toBe(true);
    expect((await v.list()).map((f) => f.path)).not.toContain("gone.md");
    expect((await v.list()).some((f) => f.path.startsWith(".trash"))).toBe(false);
  });
  it("searches", async () => {
    mkdirSync(join(root, "w"));
    writeFileSync(join(root, "w", "redis.md"), "line one\nRedis TTL note\n");
    const hits = await v.search("redis ttl", {});
    expect(hits[0]?.path).toBe("w/redis.md");
    expect(hits[0]?.lines[0]?.n).toBe(2);
  });
});

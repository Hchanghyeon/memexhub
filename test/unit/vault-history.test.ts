import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHistory } from "../../src/platform/git-history.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { SearchIndex } from "../../src/storage/search-index.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

let root: string, gitDir: string, v: SafeVault;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mx-hv-"));
  gitDir = join(mkdtempSync(join(tmpdir(), "mx-hg-")), "vault.git");
  writeFileSync(join(root, "Seeds.md"), "first\n");
  const db = sqliteDb(":memory:");
  await migrate(db);
  v = new SafeVault(new FsStorage(root), { readOnly: false, protectedPaths: ["rules.md"], writeOncePaths: ["raw/**"], maxWriteBytes: 1e6 }, db, "claude:test", {
    index: new SearchIndex(db),
    source: "fs:t",
    history: new GitHistory(gitDir, root),
  });
});

describe("vault change history (git beside the vault)", () => {
  it("is ready on this machine", async () => expect(await GitHistory.available()).toBe(true));

  it("keeps the version a person wrote outside before Claude overwrites it, and records every write", async () => {
    await v.write("Seeds.md", "claude 1\n");
    writeFileSync(join(root, "Seeds.md"), "edited in Obsidian\n"); // outside memexhub
    await v.write("Seeds.md", "claude 2\n");
    const h = await v.history("Seeds.md");
    expect(h.map((x) => x.message)).toEqual(["claude:test: write Seeds.md", "outside: Seeds.md", "claude:test: write Seeds.md", "start: the vault as it was"]);
    expect(await v.historyText("Seeds.md", h[1]!.rev)).toBe("edited in Obsidian\n");
    expect(await v.historyText("Seeds.md", h[3]!.rev)).toBe("first\n");
    expect(existsSync(join(root, ".git"))).toBe(false); // nothing inside the vault
  });

  it("restores an earlier version as a new change, follows moves, records trash", async () => {
    await v.write("Seeds.md", "changed\n");
    const first = (await v.history("Seeds.md")).at(-1)!;
    await v.withActor("admin:1").restore("Seeds.md", first.rev);
    expect(readFileSync(join(root, "Seeds.md"), "utf8")).toBe("first\n");
    expect((await v.history("Seeds.md"))[0]!.message).toBe(`admin:1: restore ${first.rev.slice(0, 7)} Seeds.md`);
    await v.move("Seeds.md", "garden/Seeds.md");
    expect((await v.history("garden/Seeds.md")).length).toBeGreaterThanOrEqual(4);
    expect(await v.historyText("garden/Seeds.md", first.rev)).toBe("first\n");
    await v.trash("garden/Seeds.md");
    expect((await v.history("garden/Seeds.md"))[0]!.message).toBe("claude:test: trash garden/Seeds.md");
  });

  it("records outside changes in one sync, ignores .obsidian and .trash, and refuses bad revisions", async () => {
    writeFileSync(join(root, "new.md"), "from the phone\n");
    writeFileSync(join(root, "Seeds.md"), "phone edit\n");
    await v.history("Seeds.md"); // first use creates the repository
    expect(await v.recordOutsideChanges()).toBe(0); // the first record already took everything
    writeFileSync(join(root, "new.md"), "again\n");
    expect(await v.recordOutsideChanges()).toBe(1);
    await v.write(".obsidian/x.md", "ui state").catch(() => {});
    expect((await v.historyStats())!.commits).toBe(2);
    await expect(v.historyText("Seeds.md", "HEAD; rm -rf /")).rejects.toMatchObject({ code: "not_found" });
    await expect(v.historyText("Seeds.md", "0123456789abcdef0123")).rejects.toMatchObject({ code: "not_found" });
  });

  it("restore follows the same rules as any write", async () => {
    const rev = (await v.history("Seeds.md")).at(-1)!.rev;
    writeFileSync(join(root, "rules.md"), "rules");
    await v.recordOutsideChanges();
    await expect(v.restore("rules.md", (await v.history("rules.md"))[0]!.rev)).rejects.toMatchObject({ code: "forbidden" });
    expect(rev).toMatch(/^[0-9a-f]{40}$/);
  });
});

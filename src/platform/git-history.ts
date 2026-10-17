import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HistoryEntry, VaultHistory } from "../storage/history.js";
import { REV } from "../storage/history.js";

const EXCLUDE = [".obsidian/", ".trash/", ".DS_Store", "*.tmp", ".*.tmp"].join("\n") + "\n";
const SEP = "\u001f";

/**
 * Vault history with git. The repository lives in DATA_DIR (--git-dir), the vault is the work tree,
 * so the vault folder gets no .git and phone sync is not affected. Commands run one at a time,
 * with argument arrays (no shell) and timeouts.
 */
export class GitHistory implements VaultHistory {
  private queue: Promise<unknown> = Promise.resolve();
  private ready?: Promise<void>;

  constructor(private gitDir: string, private workTree: string) {}

  /** Is git installed? (checked once) */
  static async available(): Promise<boolean> {
    return new Promise((res) => execFile("git", ["--version"], { timeout: 5000 }, (e) => res(!e)));
  }

  private run(args: string[], ok: number[] = [0]): Promise<string> {
    const full = ["--git-dir", this.gitDir, "--work-tree", this.workTree, "-c", "core.quotepath=false", "-c", "user.name=memexhub", "-c", "user.email=memexhub@localhost", "-c", "commit.gpgsign=false", ...args];
    return new Promise((res, rej) =>
      execFile("git", full, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024, cwd: this.workTree }, (e, out) => {
        const code = e ? ((e as { code?: number }).code ?? 1) : 0;
        if (ok.includes(code)) res(out);
        else rej(new Error(`git ${args[0]} failed`));
      }),
    );
  }

  /** Serialize: git keeps one index lock per repository. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      if (existsSync(join(this.gitDir, "HEAD"))) return;
      mkdirSync(this.gitDir, { recursive: true, mode: 0o700 });
      await this.run(["init", "-q"]);
      mkdirSync(join(this.gitDir, "info"), { recursive: true });
      writeFileSync(join(this.gitDir, "info", "exclude"), EXCLUDE);
      await this.run(["add", "-A"]);
      await this.run(["commit", "-q", "--allow-empty", "-m", "start: the vault as it was"]);
    })();
    return this.ready;
  }

  /** Commit what is staged, if anything. Returns the number of files committed. */
  private async commitStaged(message: string, paths?: string[]): Promise<number> {
    const names = (await this.run(["diff", "--cached", "--name-only", ...(paths ? ["--", ...paths] : [])])).split("\n").filter(Boolean);
    if (!names.length) return 0;
    await this.run(["commit", "-q", "-m", message.slice(0, 300), ...(paths ? ["--", ...paths] : [])]);
    return names.length;
  }

  record(paths: string[], message: string) {
    return this.serial(async () => {
      await this.init();
      const ps = paths.filter((p) => p && !p.startsWith(".obsidian/") && !p.startsWith(".trash/"));
      if (!ps.length) return;
      await this.run(["add", "-A", "--", ...ps]);
      await this.commitStaged(message, ps);
    });
  }

  recordAll(message: string) {
    return this.serial(async () => {
      await this.init();
      await this.run(["add", "-A"]);
      return this.commitStaged(message);
    });
  }

  log(path: string, limit: number) {
    return this.serial(async (): Promise<HistoryEntry[]> => {
      await this.init();
      const out = await this.run(["log", "--follow", `-n${Math.min(Math.max(limit, 1), 200)}`, `--format=%H${SEP}%cI${SEP}%s`, "--", path]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [rev, date, message] = l.split(SEP) as [string, string, string];
          return { rev, date, message };
        });
    });
  }

  show(path: string, rev: string) {
    if (!REV.test(rev)) return Promise.reject(new Error("bad revision"));
    return this.serial(async () => {
      await this.init();
      // Follow renames: find the path this note had at that revision.
      const names = (await this.run(["log", "--follow", "--name-only", "--format=%H", "--", path])).split("\n").filter(Boolean);
      let at = path;
      for (let i = 0; i < names.length; i++) if (names[i]!.startsWith(rev) && names[i + 1] && !REV.test(names[i + 1]!)) at = names[i + 1]!;
      return this.run(["show", `${rev}:${at}`]);
    });
  }

  stats() {
    return this.serial(async () => {
      await this.init();
      return { commits: Number((await this.run(["rev-list", "--count", "HEAD"])).trim()) || 0 };
    });
  }
}

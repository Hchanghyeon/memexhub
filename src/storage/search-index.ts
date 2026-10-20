import type { Db } from "../platform/types.js";
import type { FileInfo } from "./types.js";

/**
 * Full-text search index of the vault's notes in the database (SQLite FTS5, trigram tokenizer).
 * Trigrams match inside words, so Korean particles and missing spaces do not get in the way
 * ("커넥션" finds "커넥션을"). The vault stays the source of truth: the index can be dropped and rebuilt
 * at any time, and when FTS5 is missing (some D1 or old SQLite) search simply falls back to scanning.
 * Design: vault note "설계 8 - 목차와 검색 색인".
 */
export interface SearchHit {
  path: string;
  lines: { n: number; text: string }[];
}

const MAX_LINES = 5;
const LINE_CHARS = 300;
const WEIGHTS = "0, 10.0, 6.0, 4.0, 1.0"; // path, title, aliases, summary, body

/** Title, aliases, summary and body of a note, plus the line where the body starts (after frontmatter). */
export function fields(path: string, text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  const fm: Record<string, string> = {};
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      let listKey = "";
      for (const l of lines.slice(1, end)) {
        const item = l.match(/^\s+-\s+(.*)$/);
        if (item && listKey) {
          fm[listKey] = `${fm[listKey] ?? ""} ${item[1]}`.trim();
          continue;
        }
        const kv = l.match(/^([\w가-힣-]+):\s*(.*)$/);
        if (!kv) continue;
        listKey = kv[2] === "" ? kv[1]! : "";
        fm[kv[1]!] = kv[2]!.replace(/^\[(.*)\]$/, "$1").replace(/["']/g, "").replace(/,\s*/g, " ").trim();
      }
      start = end + 1;
    }
  }
  const body = lines.slice(start);
  const quote = body.findIndex((l) => l.startsWith(">"));
  let summary = "";
  if (quote >= 0 && body.slice(0, quote).every((l) => !l.trim() || l.startsWith("#"))) {
    const q: string[] = [];
    for (const l of body.slice(quote)) {
      if (!l.startsWith(">")) break;
      q.push(l.replace(/^>\s?/, ""));
    }
    summary = q.join(" ");
  } else summary = body.find((l) => l.trim() && !l.startsWith("#")) ?? "";
  return {
    title: fm.title || path.split("/").pop()!.replace(/\.md$/i, ""),
    aliases: fm.aliases ?? "",
    summary: summary.slice(0, LINE_CHARS),
    body: body.join("\n"),
    bodyLine: start + 1, // 1-based line number of body line 0
  };
}

/** A date range filter ("YYYY-MM-DD" inclusive). */
export interface DayRange { since?: string; until?: string }

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/**
 * The days a note is about: a date in its path (a journal "2026-10-19", a monthly note "2026-10" = the month),
 * else frontmatter date or created through updated. Undefined when the note carries no date.
 */
export function noteDays(path: string, text: string): { from: string; to: string } | undefined {
  const name = path.split("/").pop()!;
  const d = name.match(/(\d{4})-(\d{2})-(\d{2})/) ?? path.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (d) return { from: d[0], to: d[0] };
  const m = name.match(/(?:^|[^\d])(\d{4})-(\d{2})(?![\d-])/);
  if (m) return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(lastDay(+m[1]!, +m[2]!)).padStart(2, "0")}` };
  if (!text.startsWith("---")) return undefined;
  const fm = text.slice(0, 2000);
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*["']?(\\d{4}-\\d{2}-\\d{2})`, "m"))?.[1];
  const from = get("date") ?? get("created");
  if (!from) return undefined;
  const to = get("updated");
  return { from, to: to && to > from ? to : from };
}
export const inRange = (days: { from: string; to: string } | undefined, r: DayRange) =>
  !r.since && !r.until ? true : !!days && (!r.since || days.to >= r.since) && (!r.until || days.from <= r.until);

/** Words and "quoted phrases" of a query; FTS syntax in them is never interpreted. */
export function terms(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? "").trim();
    if (t) out.push(t);
  }
  return out.slice(0, 12);
}

const sig = (f: { size: number; mtime: Date; etag?: string }) => f.etag ?? `${f.size}:${+f.mtime}`;

export class SearchIndex {
  private state: "unknown" | "on" | "off" = "unknown";
  private running?: Promise<void>;

  constructor(private db: Db) {}

  /** Creates the tables on first use. False when this database has no FTS5 trigram support. */
  async available(): Promise<boolean> {
    if (this.state !== "unknown") return this.state === "on";
    try {
      await this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS vault_search USING fts5(path UNINDEXED, title, aliases, summary, body, tokenize = 'trigram')`);
      await this.db.run(`CREATE TABLE IF NOT EXISTS vault_search_files (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, sig TEXT NOT NULL, mtime TEXT NOT NULL, body_line INTEGER NOT NULL)`);
      await this.db.run(`CREATE TABLE IF NOT EXISTS vault_search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      // Dates (added later): an index built before has no dates, so it is rebuilt once.
      const cols = await this.db.all<{ name: string }>(`PRAGMA table_info(vault_search_files)`);
      if (!cols.some((c) => c.name === "day_from")) {
        await this.db.run(`ALTER TABLE vault_search_files ADD COLUMN day_from TEXT`);
        await this.db.run(`ALTER TABLE vault_search_files ADD COLUMN day_to TEXT`);
        await this.db.batch([{ sql: `DELETE FROM vault_search` }, { sql: `DELETE FROM vault_search_files` }, { sql: `DELETE FROM vault_search_meta` }]);
      }
      this.state = "on";
    } catch {
      this.state = "off";
    }
    return this.state === "on";
  }

  private async meta(key: string) {
    return (await this.db.get<{ value: string }>(`SELECT value FROM vault_search_meta WHERE key = ?`, [key]))?.value;
  }
  private async setMeta(key: string, value: string) {
    await this.db.run(`INSERT OR REPLACE INTO vault_search_meta (key, value) VALUES (?, ?)`, [key, value]);
  }

  async upsert(path: string, text: string, info: { size: number; mtime: Date; etag?: string }) {
    if (!(await this.available())) return;
    const f = fields(path, text);
    const days = noteDays(path, text);
    const old = await this.db.get<{ id: number }>(`SELECT id FROM vault_search_files WHERE path = ?`, [path]);
    const stmts = [
      ...(old ? [{ sql: `DELETE FROM vault_search WHERE rowid = ?`, params: [old.id] }, { sql: `DELETE FROM vault_search_files WHERE id = ?`, params: [old.id] }] : []),
      { sql: `INSERT INTO vault_search_files (path, sig, mtime, body_line, day_from, day_to) VALUES (?, ?, ?, ?, ?, ?)`, params: [path, sig(info), info.mtime.toISOString(), f.bodyLine, days?.from ?? null, days?.to ?? null] },
      { sql: `INSERT INTO vault_search (rowid, path, title, aliases, summary, body) SELECT id, ?, ?, ?, ?, ? FROM vault_search_files WHERE path = ?`, params: [path, f.title, f.aliases, f.summary, f.body, path] },
    ];
    await this.db.batch(stmts);
  }

  async remove(path: string) {
    if (!(await this.available())) return;
    const old = await this.db.get<{ id: number }>(`SELECT id FROM vault_search_files WHERE path = ?`, [path]);
    if (old) await this.db.batch([{ sql: `DELETE FROM vault_search WHERE rowid = ?`, params: [old.id] }, { sql: `DELETE FROM vault_search_files WHERE id = ?`, params: [old.id] }]);
  }

  async clear() {
    if (!(await this.available())) return;
    await this.db.batch([{ sql: `DELETE FROM vault_search` }, { sql: `DELETE FROM vault_search_files` }, { sql: `DELETE FROM vault_search_meta` }]);
  }

  /**
   * Bring the index in line with the vault: re-read only notes whose size/time changed, drop removed ones.
   * `source` names the vault; a different vault starts from scratch. One run at a time.
   */
  async reconcile(files: FileInfo[], read: (path: string) => Promise<string>, source: string): Promise<{ changed: number; removed: number }> {
    if (!(await this.available())) return { changed: 0, removed: 0 };
    if (this.running) await this.running;
    let result = { changed: 0, removed: 0 };
    this.running = (async () => {
      if ((await this.meta("source")) !== source) {
        await this.clear();
        await this.setMeta("source", source);
      }
      const stored = new Map((await this.db.all<{ path: string; sig: string }>(`SELECT path, sig FROM vault_search_files`)).map((r) => [r.path, r.sig]));
      const notes = files.filter((f) => f.path.toLowerCase().endsWith(".md"));
      for (const f of notes) {
        if (stored.get(f.path) === sig(f)) continue;
        try {
          await this.upsert(f.path, await read(f.path), f);
          result.changed++;
        } catch {
          // unreadable right now (being synced): next run
        }
      }
      const live = new Set(notes.map((f) => f.path));
      for (const p of stored.keys())
        if (!live.has(p)) {
          await this.remove(p);
          result.removed++;
        }
      await this.setMeta("ready", "1");
      await this.setMeta("updated", new Date().toISOString());
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    return result;
  }

  async stats(): Promise<{ available: boolean; ready: boolean; notes: number; updated: string | null }> {
    if (!(await this.available())) return { available: false, ready: false, notes: 0, updated: null };
    const n = (await this.db.get<{ n: number }>(`SELECT COUNT(*) n FROM vault_search_files`))?.n ?? 0;
    return { available: true, ready: (await this.meta("ready")) === "1", notes: n, updated: (await this.meta("updated")) ?? null };
  }

  /**
   * Notes matching every term, best first (title > aliases > summary > body, then newest).
   * undefined = the index cannot answer (off, or not built yet): the caller scans instead.
   */
  async search(query: string, limit: number, range: DayRange = {}): Promise<SearchHit[] | undefined> {
    if (!(await this.available()) || (await this.meta("ready")) !== "1") return undefined;
    const ts = terms(query);
    const dated = !!(range.since || range.until);
    if (!ts.length && !dated) return [];
    const long = ts.filter((t) => [...t].length >= 3);
    const short = ts.filter((t) => [...t].length < 3);
    const where: string[] = [];
    const params: unknown[] = [];
    if (long.length) {
      where.push(`vault_search MATCH ?`);
      params.push(long.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND "));
    }
    for (const t of short) {
      // Too short for trigrams: filter the stored text instead (no file is read).
      where.push(`(s.title LIKE ? ESCAPE '\\' OR s.aliases LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR s.body LIKE ? ESCAPE '\\')`);
      const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like, like, like);
    }
    if (range.since) {
      where.push(`f.day_to >= ?`);
      params.push(range.since);
    }
    if (range.until) {
      where.push(`f.day_from <= ?`);
      params.push(range.until);
    }
    // Without words, a date search lists the notes of the period, newest first.
    const order = long.length ? `bm25(vault_search, ${WEIGHTS}), f.mtime DESC` : dated && !ts.length ? `f.day_from DESC, f.path` : `f.mtime DESC`;
    const rows = await this.db.all<{ path: string; body: string; body_line: number }>(
      `SELECT f.path, s.body, f.body_line FROM vault_search s JOIN vault_search_files f ON f.id = s.rowid WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
      [...params, Math.min(Math.max(limit, 1), 200)],
    );
    const lower = ts.map((t) => t.toLowerCase());
    return rows.map((r) => {
      const lines: SearchHit["lines"] = [];
      r.body.split("\n").forEach((l, i) => {
        if (lines.length < MAX_LINES && lower.length && lower.some((t) => l.toLowerCase().includes(t))) lines.push({ n: r.body_line + i, text: l.slice(0, LINE_CHARS) });
      });
      return { path: r.path, lines };
    });
  }
}

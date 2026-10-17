import type { Db } from "../platform/types.js";
import { decrypt, encrypt } from "./crypto.js";

/**
 * Logical, encrypted backups of the database (works the same on SQLite and D1).
 * Sessions, one-time codes, caches (place names, map pictures) and the search index are left out; everything else — settings, encrypted connections,
 * tokens (hashes), events, inbox, audit — is kept. Restoring needs the same MEMEXHUB_SECRET, because
 * connection secrets inside are encrypted with it as well.
 */
const SKIP = new Set(["schema_migrations", "admin_sessions", "admin_trusted", "oauth_codes", "geocode_cache", "map_tiles"]);
const PURPOSE = "backup";
const AAD = "memexhub-backup-v1";
const IDENT = /^[a-z_][a-z0-9_]*$/;

async function tables(db: Db) {
  const rows = await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  // The search index (vault_search*) and map pictures are rebuilt from the vault / fetched again.
  return rows.map((r) => r.name).filter((n) => IDENT.test(n) && !SKIP.has(n) && !n.startsWith("vault_search"));
}

export async function exportBackup(db: Db, secret: string, now = new Date()): Promise<string> {
  const migration = (await db.get<{ id: number }>(`SELECT MAX(id) id FROM schema_migrations`))?.id ?? 0;
  const data: Record<string, unknown[]> = {};
  for (const t of await tables(db)) data[t] = await db.all(`SELECT * FROM ${t}`);
  const json = JSON.stringify({ format: "memexhub-backup", version: 1, created: now.toISOString(), migration, tables: data });
  return `memexhub-backup-v1\n${await encrypt(secret, PURPOSE, json, AAD)}\n`;
}

/** Replaces the current data with the backup's, atomically. Refuses backups from a newer schema. */
export async function importBackup(db: Db, secret: string, blob: string): Promise<{ tables: number; rows: number; created: string }> {
  const [head, body] = blob.trim().split("\n");
  if (head !== "memexhub-backup-v1" || !body) throw new Error("not a memexhub backup file");
  let parsed: { format?: string; migration?: number; created?: string; tables?: Record<string, Record<string, unknown>[]> };
  try {
    parsed = JSON.parse(await decrypt(secret, PURPOSE, body, AAD));
  } catch {
    throw new Error("cannot decrypt: this backup was made with a different MEMEXHUB_SECRET, or the file is damaged");
  }
  if (parsed.format !== "memexhub-backup" || !parsed.tables) throw new Error("not a memexhub backup file");
  const current = (await db.get<{ id: number }>(`SELECT MAX(id) id FROM schema_migrations`))?.id ?? 0;
  if ((parsed.migration ?? 0) > current) throw new Error("this backup is from a newer memexhub: upgrade first");
  const known = new Set(await tables(db));
  const stmts: { sql: string; params?: unknown[] }[] = [];
  let rows = 0;
  for (const t of known) stmts.push({ sql: `DELETE FROM ${t}` });
  for (const [t, list] of Object.entries(parsed.tables)) {
    if (!known.has(t) || !Array.isArray(list)) continue;
    const cols = new Set((await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
    for (const r of list) {
      const keys = Object.keys(r).filter((k) => cols.has(k) && IDENT.test(k));
      if (!keys.length) continue;
      stmts.push({ sql: `INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, params: keys.map((k) => r[k]) });
      rows++;
    }
  }
  await db.batch(stmts);
  return { tables: Object.keys(parsed.tables).filter((t) => known.has(t)).length, rows, created: parsed.created ?? "" };
}

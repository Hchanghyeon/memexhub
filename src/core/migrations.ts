import type { Db } from "../platform/types.js";

/** Append-only list. Never edit a released migration — add a new one. */
const MIGRATIONS: { id: number; sql: string[] }[] = [
  {
    id: 1,
    sql: [
      `CREATE TABLE admins (
         id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
         totp_secret_enc TEXT, created_at TEXT NOT NULL)`,
      `CREATE TABLE admin_sessions (
         id_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL, csrf TEXT NOT NULL,
         created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE connections (
         id TEXT PRIMARY KEY, kind TEXT NOT NULL, provider TEXT NOT NULL, name TEXT NOT NULL,
         config TEXT NOT NULL, secrets_enc TEXT, enabled INTEGER NOT NULL DEFAULT 1,
         status TEXT, last_ok_at TEXT, last_error TEXT, created_at TEXT NOT NULL,
         UNIQUE(kind, name))`,
      `CREATE TABLE ingest_tokens (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
         created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)`,
      `CREATE TABLE oauth_clients (
         client_id TEXT PRIMARY KEY, client_name TEXT, redirect_uris TEXT NOT NULL, created_at TEXT NOT NULL,
         revoked_at TEXT)`,
      `CREATE TABLE oauth_codes (
         code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
         code_challenge TEXT NOT NULL, resource TEXT, expires_at TEXT NOT NULL, used_at TEXT)`,
      `CREATE TABLE oauth_tokens (
         token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, family TEXT NOT NULL,
         resource TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT)`,
      `CREATE INDEX oauth_tokens_family ON oauth_tokens(family)`,
      `CREATE TABLE events (
         id TEXT PRIMARY KEY, type TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
         source TEXT NOT NULL, payload TEXT NOT NULL, skipped TEXT)`,
      `CREATE INDEX events_type_time ON events(type, occurred_at)`,
      `CREATE TABLE cursors (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE audit (
         id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
         target TEXT, detail TEXT)`,
    ],
  },
];

export async function migrate(db: Db): Promise<number> {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set((await db.all<{ id: number }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.batch([
      ...m.sql.map((sql) => ({ sql })),
      { sql: `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`, params: [m.id, new Date().toISOString()] },
    ]);
    applied++;
  }
  return applied;
}

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
  {
    id: 2,
    sql: [
      // Messages a module could not read, waiting for Claude or the admin. Text is encrypted; cleared when resolved.
      `CREATE TABLE inbox (
         id TEXT PRIMARY KEY, module TEXT NOT NULL, channel TEXT NOT NULL, received_at TEXT NOT NULL,
         reason TEXT NOT NULL, blob TEXT, status TEXT NOT NULL DEFAULT 'pending', resolved_at TEXT)`,
      `CREATE INDEX inbox_module_status ON inbox(module, status, received_at)`,
    ],
  },
  {
    id: 3,
    sql: [
      // OwnTracks-style points sent to /ingest/owntracks. Database only — coordinates never go into the vault.
      `CREATE TABLE location_points (t INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, acc REAL, device TEXT NOT NULL DEFAULT '')`,
      `CREATE INDEX location_points_t ON location_points(t)`,
      `CREATE TABLE geocode_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL)`,
    ],
  },
  {
    id: 4,
    sql: [
      // Which Notion page mirrors which record, and a hash of what was sent — re-syncing never duplicates rows.
      `CREATE TABLE notion_rows (kind TEXT NOT NULL, key TEXT NOT NULL, page_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (kind, key))`,
    ],
  },
  {
    id: 5,
    sql: [
      // Access log: who reached the server from which IP (sign-ins, Claude, devices). See core/access.ts.
      `CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, who TEXT, ip TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT)`,
      `CREATE INDEX access_log_at ON access_log (at)`,
    ],
  },
  {
    id: 6,
    sql: [
      // Browsers that passed two-factor and asked to be remembered (30 days). Only a hash of the cookie is kept.
      `CREATE TABLE admin_trusted (id_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    ],
  },
  {
    id: 7,
    sql: [
      // Map background pictures fetched for the admin map (base64, kept 30 days). See providers/maptiles.
      `CREATE TABLE map_tiles (key TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL)`,
      `CREATE INDEX map_tiles_at ON map_tiles (at)`,
    ],
  },
  {
    id: 8,
    sql: [
      // Bundled recipes became opt-in. An install that already had an admin keeps the four it was using.
      `INSERT INTO settings (key, value, updated_at)
       SELECT 'recipePacks', '["kr.hyundai.sms","kr.samsung.sms","kr.kcp.mail","kr.kicc.mail"]', '2026-10-18T00:00:00Z'
       WHERE EXISTS (SELECT 1 FROM admins) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'recipePacks')`,
    ],
  },
  {
    id: 9,
    sql: [
      // "Stay signed in": a session with an end date instead of the 30-minute idle limit.
      `ALTER TABLE admin_sessions ADD COLUMN expires_at TEXT`,
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

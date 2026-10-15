# Configuration and storage

## Environment variables (only these)

| Variable | Required | Meaning |
|---|---|---|
| `MEMEXHUB_SECRET` | ✅ | ≥32 chars. Encrypts stored secrets. Generate with `openssl rand -base64 48`, keep it in a password manager. Placeholder values are rejected. |
| `PUBLIC_URL` | ✅ | External URL of the MCP surface (OAuth issuer). Must be `https://` (http only for localhost). |
| `DATA_DIR` | ✅ | Where `memexhub.db`, the built-in vault, cache and backups live. Created with mode 700. |
| `LISTEN` | | `split` (default) or `single` |
| `MCP_PORT` / `INGEST_PORT` / `ADMIN_PORT` / `SINGLE_PORT` | | 8787 / 8790 / 8791 / 8787 |
| `TZ` | | time zone |
| `VAULT_ROOTS` | | folders the admin UI may choose as an existing vault (default `/vaults`). A security boundary — the UI can never point at arbitrary paths. |
| `TRUSTED_PROXIES` | | CIDRs of your reverse proxy. `X-Real-IP` / `X-Forwarded-For` are only trusted from these peers. |

Everything else — admin accounts, vault location, modules, connections, tokens, allowlists, tool language — is set in the admin UI and stored in the database.

## `DATA_DIR`

```
DATA_DIR/
├─ memexhub.db   SQLite (WAL), mode 600
├─ vault/        built-in vault (if chosen)
├─ cache/        remote-vault cache and search index (safe to delete) 📝
└─ backups/      daily encrypted database backups (newest 14)
```

| Table | Content | Secret handling |
|---|---|---|
| `admins` | admin accounts | PBKDF2-SHA256 (600k) password hash, TOTP secret encrypted |
| `admin_sessions` | sessions | session id stored as SHA-256 hash, CSRF token, 30-min idle expiry |
| `settings` | non-secret settings (JSON per key) | — |
| `connections` | provider connections | `secrets_enc`: AES-256-GCM, HKDF key per purpose, AAD = connection id; never returned by any API |
| `ingest_tokens` | device tokens, scopes, last use | SHA-256 hash only; shown once |
| `oauth_clients` / `oauth_codes` / `oauth_tokens` | connector registrations, one-time codes, access/refresh tokens | hashes only |
| `events` | append-only facts (payments, health, …) | — |
| `cursors` | read positions (mail UID …) | — |
| `audit` | who changed what | no content, no secrets |

Losing `MEMEXHUB_SECRET` only makes `connections.secrets_enc` unreadable: reconnect those accounts; settings and records survive.

## Where the vault lives

The setup wizard first asks *how do you sync Obsidian today?* and recommends one of:

| Option | When | Status |
|---|---|---|
| **Create on this server** (recommended) | new start / no sync yet | ✅ folder · built-in WebDAV for Obsidian sync ✅ |
| Existing folder on this server | the vault is already on the server | ✅ (must be under `VAULT_ROOTS`) |
| WebDAV | Nextcloud, NAS WebDAV, Remotely Save WebDAV | ✅ |
| S3 / R2 / MinIO | Remotely Save S3 | ✅ |
| Git | Obsidian Git | 📝 |

Obsidian Sync (official) and iCloud have no server API — use one of the options above in addition.

## Vault safety (applies to every storage)

`SafeVault` is the only way modules touch the vault:

- paths are normalized; `..`, absolute paths, NUL and hidden files/folders are rejected; only `.md` notes
- **protected paths** (default `CLAUDE.md`, `AGENTS.md`, `_templates/**`, `.obsidian/**`; add your routine rule notes) cannot be written by tools
- optional read-only mode, write size limit (default 512 KB)
- delete = move to `.trash/` with a timestamp; trash is hidden from listings
- writes are skipped when content is unchanged (no sync churn)
- every write is audited (path, size, hash prefix — never content)

## Built-in WebDAV (sync the server's vault) ✅

When the vault lives on the server (built-in or a folder), memexhub can serve it over WebDAV so Obsidian on your phone and PC syncs with it — no second server.

1. Admin UI → Vault → **Sync with Obsidian on your devices** → on.
2. Devices → create a token with scope `dav` for each device.
3. Obsidian → install **Remotely Save** → WebDAV: address `https://<ingest address>/dav/`, any username, the device token as password.

Off by default · Basic auth with per-device tokens (revoke one when a device is lost) · rate limited · paths can never leave the vault (traversal and symbolic links refused) · deletes go to `.trash` (invisible over WebDAV) · file size limit (default 50 MB) · responses sandboxed (`Content-Security-Policy: sandbox`) · every write audited without content.

## Backups ✅

Admin UI → **Backups**: download an encrypted backup now, see the automatic daily copies (newest 14 in `DATA_DIR/backups`), or restore one (type `RESTORE` to confirm). A backup holds settings, connections (their secrets stay encrypted), tokens (hashes), records, the inbox and the activity log. **It needs the same `MEMEXHUB_SECRET` to restore** — keep that secret somewhere safe apart from the backup. Vault notes are not included; back the vault up with your storage or sync.

Admin UI → **Activity** shows sign-ins, vault writes by Claude and devices, settings and connection changes — never contents or secrets.

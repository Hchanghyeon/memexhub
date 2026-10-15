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
└─ backups/      daily database backups 📝
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
| **Create on this server** (recommended) | new start / no sync yet | ✅ folder · built-in WebDAV for Obsidian sync 📝 |
| Existing folder on this server | the vault is already on the server | ✅ (must be under `VAULT_ROOTS`) |
| WebDAV | Nextcloud, NAS WebDAV, Remotely Save WebDAV | ✅ |
| S3 / R2 | Remotely Save S3 | 🚧 |
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

# Cloudflare (no server)

memexhub runs on **Cloudflare Workers** in your own Cloudflare account: free tier is enough for one person. One Worker serves the Claude connector (`/mcp`), devices (`/ingest/…`) and the admin UI (`/admin`); **D1** holds settings and records, an **R2** bucket holds the vault, a **cron trigger** runs the background jobs.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Hchanghyeon/memexhub)

The button forks the repository into your account, creates the D1 database and the R2 bucket from `wrangler.toml`, and asks for two secrets:

| Secret | Value |
|---|---|
| `MEMEXHUB_SECRET` | a long random value (`openssl rand -base64 48`, or any password generator, 48+ characters). **Keep a copy**: it encrypts your connections and backups. |
| `SETUP_CODE` | a one-time code you make up (12+ letters / digits) and will type in the next step |

Without the button: `npm ci && npx wrangler deploy`, then `npx wrangler secret put MEMEXHUB_SECRET` and `… SETUP_CODE`.

## Set up

1. Open `https://<your worker>.workers.dev/admin/setup`, enter the setup code, create your admin account.
2. **Turn on two-factor**: it is the only page you can reach until you do (the admin UI is on the internet here).
3. The wizard continues: time zone, vault (**this Worker's R2 bucket**), wiki layout, Claude connector `https://<your worker>.workers.dev/mcp`.

`PUBLIC_URL` defaults to the Worker's address. If you add a custom domain, set `PUBLIC_URL` to it (Settings → Variables) and reconnect Claude.

## Your vault on phones and PCs

Obsidian → **Remotely Save** → S3: endpoint `https://<account id>.r2.cloudflarestorage.com`, region `auto`, bucket `memexhub-vault`, and an **R2 API token** limited to that bucket (R2 → Manage API tokens).

## What works differently on Workers

| | Workers | Docker / server |
|---|---|---|
| Vault | R2 bucket (or WebDAV / S3 elsewhere) | built-in folder, local folder, WebDAV, S3 |
| Built-in WebDAV `/dav/` |: use Remotely Save with S3 on R2 | ✅ |
| Mail (IMAP) |: not yet (needs TCP sockets) | ✅ |
| Location | OwnTracks ✅ · Dawarich if reachable on the internet | ✅ |
| Backups | download from the admin UI | download + daily files |
| Admin UI | internet + two-factor | private network |

Everything else: wiki engine, ledger and recipes, receipt-mail recipes for other inputs, health, Google Tasks, Notion, summaries · is the same.

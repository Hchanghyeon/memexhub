# memexhub documentation

[한국어](ko/README.md)

## What works

| Area | Status |
|---|---|
| Core (settings, encrypted connections, event log, audit), runtime layer | ✅ |
| Vault storage: built-in / local folder, WebDAV, S3 / R2 / MinIO | ✅ · Git 📝 |
| Vault tools (list/read/search/stats/write/append/trash/move) with protected paths | ✅ |
| OAuth 2.1 for Claude connectors, device tokens, IP allowlist | ✅ |
| Admin UI: 3-step setup, connections, devices (phone setup by QR), 2FA with QR, notes viewer with pictures and PDFs, day map | ✅ |
| Wiki module (layout, lint, save source, index, log, backlinks), roles & presets, write-once sources | ✅ |
| Wiki harness: write check, `draft → stable → deprecated` with review in the admin app, `wiki_check`, `wiki_pending` | ✅ |
| Ledger: card SMS (Hyundai, Samsung), Apple Pay / transit, payments & money notes, receipt mails, `payments_day`, message recipes + inbox | ✅ |
| Mail (read-only IMAP: Kakao, Naver, Gmail, Outlook, custom): [docs](docs/mail.md) | ✅ |
| Location (Dawarich, OwnTracks, OSM place names), `location_day`, payment places, map screen | ✅ |
| Calendar (CalDAV, iCloud, Google), weather, Home Assistant, music (Last.fm, Spotify) | ✅ |
| Health (iOS Shortcuts, Health Auto Export), health note, `health_day` | ✅ |
| Tasks (Google Tasks, several accounts, sign-in button) | ✅ |
| `day_summary`, `week_summary` (one call per day / week for routines) | ✅ |
| Built-in WebDAV to sync the server's vault with Obsidian | ✅ |
| Notion output (payments, health): [docs](docs/notion.md) | ✅ |
| One-click Cloudflare deploy (Workers + D1 + R2): [docs](docs/cloudflare.md) | ✅ |
| Home Assistant add-on, Synology, Railway: [docs](docs/app-stores.md) | ✅ (after the first release) |
| Notion as vault storage (beta, small vaults) | ✅ |
| Share sheet: anything shared from a phone app becomes a source (`/ingest/share`) | ✅ |
| Day scenes in `day_summary` (calendar, stays, payments merged by time) · ready-made Claude routines | ✅ |

## Start
- [Install with Docker](install.md): run, expose, verify signatures, upgrade
- [Moving from another setup](migrating.md): import payments, health, device tokens
- [Cloudflare (no server)](cloudflare.md): deploy button, Workers + D1 + R2
- [Home Assistant, Synology, Railway](app-stores.md)
- [Easy install options](easy-install.md): overview

## Use with Claude
- [Claude integration](claude-integration.md): connector, OAuth, `day_summary` / `week_summary`
- [Wiki engine](wiki-engine.md): roles, presets, lint, sources, index, log
- [Ledger](ledger.md): payments and money notes · [Message recipes](recipes.md) · SMS / mail / notifications without code
- [Mail](mail.md) · [Location](location.md) · [Health](health.md) · [Tasks](tasks.md) · [Calendar](calendar.md) · [Home](home.md) · [Music](music.md) · [Notion](notion.md)

## Run
- [Configuration and storage](configuration-and-storage.md): environment, vault storage, built-in WebDAV, backups
- [Security](security.md): threat model · [Security review](security-review.md) · checklist with proofs

## Build
- [Architecture](architecture.md) · [Modules and providers](modules-and-providers.md) · [Adding a provider](adding-a-provider.md)
- [Development](development.md): branches, commits, privacy, dependencies, PRs · [UI design](design.md) · [Roadmap](roadmap.md)

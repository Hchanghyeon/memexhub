# memexhub documentation

[한국어](ko/README.md)

## What works

**Collect**

| What | State |
|---|---|
| Phone payments: card texts (recipes), Apple Pay and transit taps, office gate taps, receipt mails (KCP, KICC) | ✅ |
| Reading messages: recipes + general reader, messages to check, learning a recipe from your answer, recipe collection (off by default) | ✅ |
| Location: OwnTracks (QR setup) or Dawarich, stays and place names (OSM), the Map page | ✅ |
| Health: iOS Shortcuts, Health Auto Export | ✅ |
| [Meals](meals.md): Claude estimates calories and macros from a photo or a description, a monthly meals note, meals in scenes | ✅ |
| Share sheet: links and text shared from any app become wiki sources (`/ingest/share`) | ✅ |
| Mail (IMAP, read-only): Kakao, Naver, Gmail, Outlook, custom | ✅ |
| Calendars: Google (sign-in), iCloud, CalDAV, **calendar link (iCal, recurring events expanded)** | ✅ |
| Weather (Open-Meteo), home (Home Assistant, entities picked from a list), music (Last.fm, Spotify), tasks (Google Tasks) | ✅ |

**Organize**

| What | State |
|---|---|
| Wiki engine: roles and presets, write-once sources, indexes and sub-indexes, log, backlinks, checks | ✅ |
| Harness: write check, `draft → stable → deprecated`, `wiki_check`, `wiki_pending` | ✅ |
| Search index (FTS5) · vault change history (git, restore earlier versions) | ✅ |
| Payments, money and health notes redrawn by the engine (per year or per month) | ✅ |
| Keeping what a conversation decided (`conversation_save`) | ✅ |

**Serve**

| What | State |
|---|---|
| One MCP connector (OAuth 2.1), server instructions | ✅ |
| `day_summary` (starting with **scenes**: calendar, stays and payments merged by time) · `week_summary` | ✅ |
| Ready-made Claude routines: daily journal, wiki ingest, weekly check | ✅ |
| Notion export (payments, health) | ✅ |

**Admin pages and install** ([page guide](admin-ui.md))

| What | State |
|---|---|
| 3-step first setup, phone setup QR, two-factor QR | ✅ |
| Notes viewer (pictures, PDFs, callouts, highlights, earlier versions), the day's map | ✅ |
| Connections: short names, help on every field in English and Korean, edit and delete, errors as what-to-do sentences | ✅ |
| Messages page (please check · read by themselves · recipe collection · what is a recipe) | ✅ |
| Vault storage: built-in or server folder, WebDAV, S3 / R2 / MinIO, Notion (beta) · Git 📝 | ✅ |
| Built-in WebDAV for Obsidian sync, encrypted backups, restore, move from a previous setup | ✅ |
| Docker (signed image), Cloudflare button, Home Assistant add-on, Synology, Railway | ✅ (after the first release) |
| Logo, iPhone home-screen icon | ✅ |

## Start
- [The admin pages](admin-ui.md): what each page is for
- [Install with Docker](install.md): run, expose, verify signatures, upgrade
- [Moving from another setup](migrating.md): import payments, health, device tokens
- [Cloudflare (no server)](cloudflare.md): deploy button, Workers + D1 + R2
- [Home Assistant, Synology, Railway](app-stores.md)
- [Easy install options](easy-install.md): overview

## Use with Claude
- [Claude integration](claude-integration.md): connector, OAuth, `day_summary` / `week_summary`
- [Wiki engine](wiki-engine.md): roles, presets, lint, sources, index, log
- [Ledger](ledger.md): payments and money notes · [Message recipes](recipes.md) · SMS / mail / notifications without code
- [Mail](mail.md) · [Location](location.md) · [Health](health.md) · [Meals](meals.md) · [Tasks](tasks.md) · [Calendar](calendar.md) · [Home](home.md) · [Music](music.md) · [Notion](notion.md)

## Run
- [Configuration and storage](configuration-and-storage.md): environment, vault storage, built-in WebDAV, backups
- [Security](security.md): threat model · [Security review](security-review.md) · checklist with proofs

## Build
- [Architecture](architecture.md) · [Modules and providers](modules-and-providers.md) · [Adding a provider](adding-a-provider.md)
- [Development](development.md): branches, commits, privacy, dependencies, PRs · [UI design](design.md) · [Roadmap](roadmap.md)

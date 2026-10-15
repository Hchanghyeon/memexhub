# Roadmap

| Phase | Scope | Done when | Status |
|---|---|---|---|
| P0 | public repo, protected branches, CI (typecheck, tests, CodeQL, gitleaks, OSV), SECURITY.md, Dependabot, issue forms | CI green on an empty PR | ✅ |
| P1 | core, runtime layer, crypto, migrations, SafeVault, fs + webdav adapters, vault tools, OAuth, device tokens, admin UI (minimal), setup code, TOTP, IP allowlist | storage contract tests + end-to-end connector test (incl. attacks) pass | ✅ first cut |
| P2 | **wiki module** (layout, lint, save source, index, backlinks, log) + roles + presets + lint rule set + write-once sources | fixture-vault tests per rule | ✅ |
| P3 | ledger: card SMS issuers, Apple Pay shortcut payload, receipt-mail source, payments & money notes (auto sections) | golden tests vs. reference output · parser fuzzing | 📝 |
| P4 | mail (IMAP), location (Dawarich, OwnTracks), geocoder (OSM), health, tasks (Google), `day_summary`, `week_summary` | provider contract tests · real-account smoke tests | 📝 |
| P5 | built-in WebDAV for Obsidian sync, s3 adapter, full admin UI (connections forms from provider schemas, features, access, logs, backups, security card), Docker image, signed releases | fresh install with only the admin UI | 📝 |
| P6 | legacy import tooling, cutover guide | — | 📝 |
| P7 | docs polish, security review (OWASP ASVS L2 subset, OAuth attack suite) | checklist passes | 📝 |
| P8 | Notion output sink, then Notion storage adapter | re-rendering creates no duplicate rows | 📝 |
| P9 | one-click Cloudflare (Workers + D1 + R2 + Cron, OwnTracks ingest) | from a clean Cloudflare account to the first record in 30 min | 📝 |
| P10 | app-store packages (Home Assistant add-on, Synology, Railway template) | install → wizard completes | 📝 |
| later | calendar provider, Gmail API, Kakao Local geocoder, MCP prompts, mobile app | — | 📝 |

# Easy install (planned)

Goal: people who can't run a backend should get memexhub running with a few buttons. Data still lives in **their own** accounts: memexhub is not a hosted service.

| Path | For | Cost | How |
|---|---|---|---|
| **A. One click (Cloudflare)** | no server, no coding | mostly free | *Deploy to Cloudflare* → Workers + D1 + R2 + Cron in your account → open the URL → setup wizard |
| B. Cloud templates | want IMAP mail / Dawarich too | a few dollars/month | Railway · Render · Fly deploy buttons |
| C. App stores | have a NAS / Home Assistant | electricity | Home Assistant add-on · Synology project · Unraid · CasaOS/Umbrel |
| D. docker compose | developers | - | `compose.example.yml` |

## Path A without any server

| Need | How |
|---|---|
| vault | R2 + Obsidian **Remotely Save (S3)** on your devices; memexhub uses the same bucket via the s3 adapter (or GitHub + Obsidian Git) |
| database | D1 (same schema) |
| location | **OwnTracks** app → memexhub's OwnTracks-compatible ingest endpoint |
| mail | Gmail via sign-in button; IMAP where Workers TCP sockets allow |
| schedules | Cron Triggers |
| HTTPS URL | `*.workers.dev` |

## Things that make it easy

1. **Setup code**: a fresh public instance can't be claimed by a scanner (see [security](security.md) T11).
2. **Buttons, not keys**: sign-in buttons (Google, Gmail, Notion), IMAP presets, a *Test connection* button on every step.
3. **Shortcuts by link**: iCloud links + copy buttons for URL and token.
4. **Claude connector guide**: copy the URL, three screenshots.
5. **Vault scaffolding**: presets create folders and rule notes; a first prompt lets Claude interview you and fill in your rules.
6. **Routine prompts**: copy-paste one-liners for nightly summary, weekly review and wiki lint routines.
7. **Install docs written as a checklist** so Claude can walk you through them.
8. **Update notice + button** in the admin UI.

## Runtime layer

| Part | Node (B, C, D) | Workers (A) |
|---|---|---|
| entry | `src/main.ts` (three ports) | `worker.ts` (single, path routing) |
| database | better-sqlite3 | D1 |
| secret | env var | Worker secret |
| schedules | in-process | Cron Triggers |
| vault | fs · webdav · s3 · git | s3 (R2) · webdav · git |
| raw TCP | yes (IMAP) | limited |

Providers declare the runtimes they support; the wizard greys out the rest with a reason. CI enforces that core code does not import `node:*`.

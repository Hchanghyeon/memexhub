# Modules and providers

- **Module** = what it does (domain logic, tools, notes).
- **Provider** = where it gets data from (an external service).

Modules depend on provider **interfaces** only. Providers are chosen in the admin UI; several can be active (several mail accounts).

## Module contract

```ts
export interface ModuleDef {
  id: string;
  title: Text;                 // { en, ko }
  needs?: ("vault")[];
  setup(ctx: ModuleContext): ModuleInstance | Promise<ModuleInstance>;
}
export interface ModuleInstance {
  tools?: ToolDef[];           // MCP tools
  ingest?: IngestRoute[];      // POST endpoints on the ingest surface (with a scope)
  status?(): Promise<{ ok: boolean; detail?: string }>;
}
export interface ToolDef {
  name: string;                // English identifier
  description: Text;           // bilingual; settings.toolLanguage = en | ko | both
  input: ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;       // hidden unless explicitly enabled
  run(args, ctx): Promise<string>;
}
```

Adding a module: a folder in `src/modules/` and one line in `src/modules/index.ts`. Modules reload when settings change — no restart.

## Provider contract ✅

```ts
export interface ProviderDef<K extends Kind, C, S> {
  kind: K;                     // "storage" | "mail" | "location" | "geocoder" | "health" | "tasks" | "calendar"
  id: string;                  // "imap", "gmail", "dawarich" …
  title: Text;
  config: ZodType<C>;          // visible settings → admin form generated automatically
  secrets: ZodType<S>;         // encrypted, write-only
  oauth?: OAuthSpec;           // shows a "Sign in" button
  runtimes: ("node" | "workers")[];
  create(c: C, s: S, ctx): Promise<KindMap[K]>;
  test(p: KindMap[K]): Promise<TestResult>;   // "Test connection"
}
```

## Provider kinds

| Kind | Interface | v1 | Later |
|---|---|---|---|
| storage | `read · write(ifMatch/ifNoneMatch) · list · stat · move` (+ capabilities) | fs ✅ · webdav ✅ · s3 ✅ · r2 ✅ · notion ✅ (beta) | git · couchdb · cloud drives |
| mail | `folders · search · read · digestFolders` | imap ✅ | gmail API |
| location | `points · areas · visits?` | dawarich ✅ · owntracks ✅ | own app |
| geocoder | `reverse` | OpenStreetMap Nominatim ✅ | Kakao Local, Naver |
| health | ingest payload → standard records | shortcut ✅ · Health Auto Export ✅ | Health Connect, app |
| tasks | `lists · list · add · update · complete · delete` | google ✅ | todoist, reminders |
| calendar | `calendars · events(from, to)` | CalDAV ✅ · iCloud ✅ · Google ✅ | — |
| weather | `place · days(from, to)` | Open-Meteo ✅ | — |
| home | `states · logbook(from, to, entity?)` (read-only) | Home Assistant ✅ | — |
| music | `plays(from, to)` · `history` | Last.fm ✅ · Spotify ✅ (recent 50, collected every 30 min) | — |

## Modules

| Module | Tools | Ingest | Notes | Status |
|---|---|---|---|---|
| vault | `list_notes` `read_note` `search_notes` `vault_stats` `note_history` `write_note` `append_note` `delete_note` `move_note` | — | — | ✅ |
| hub | `hub_status`, `day_summary`, `week_summary` | — | — | ✅ |
| wiki | `wiki_layout` `wiki_lint` `wiki_save_source` `wiki_index` `wiki_backlinks` `wiki_log` `wiki_check` `wiki_pending` | — | index, log | ✅ |
| ledger | `payments_day` ✅, `payments_from_mail` ✅ | `/ingest/message` `/ingest/transaction` | payments, money | ✅ |
| mail | `mail_folders` `mail_search` `mail_read` `mail_day` | — | — | ✅ ([mail](mail.md)) |
| location | `location_day` | `/ingest/owntracks` | — | ✅ ([location](location.md)) |
| health | `health_day` | `/ingest/health` | health | ✅ ([health](health.md)) |
| tasks | `task_*` | — | — | ✅ ([tasks](tasks.md)) |
| calendar | `calendar_list` `calendar_events` | — | — | ✅ ([calendar](calendar.md)) |
| weather | `weather_days` | — | — | ✅ |
| home | `home_states` `home_day` | — | — | ✅ ([home](home.md)) |
| music | `music_day` | — | — | ✅ ([music](music.md)) |

## Ledger: message recipes ✅

```ts
interface Message   { channel: "sms" | "mail" | "notification" | "text"; from?: string; subject?: string; text: string }
interface Extractor { id: string; extract(m: Message): Extraction | null }   // chain: vault recipes → built-in recipes → generic parser
// unreadable → inbox (encrypted) → Claude resolves or proposes a recipe note
```

A new card company or shop = **one recipe** (JSON in a vault note, or `recipes/*.json` in the repository) with fake examples — no code. See [message recipes](recipes.md). Shared logic (dedupe, cancellations, transit vs. office tags, online merchants, late messages) lives once in the module. Personal places (home, office) are settings, never code.

## Rendering: data → output sink

Modules turn events into a view model and hand it to an output sink: `obsidian-markdown`, `notion-database` ([notion](notion.md)). Notes shared with humans are only changed inside auto sections:

```
<!-- memexhub:auto id=money -->
…generated…
<!-- /memexhub:auto -->
```

## Notion ✅ output · ✅ storage (beta)

Output sink: [notion](notion.md).

1. **Output first**: write structured records (payments, health, days) as rows of a Notion database. No conversion loss; Notion's filters and totals just work.
2. **Storage later**: a `notion` storage adapter (folders → parent pages, notes → pages). Lossy (wikilinks, callouts, frontmatter) and rate-limited.

With both Obsidian and Notion, the vault stays the source of truth and Notion is output-only — no two-way sync. Share only the needed pages with the Notion integration.

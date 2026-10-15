# CLAUDE.md — guide for AI coding agents

memexhub is a self-hosted **LLM Wiki engine**: an Obsidian vault is the memory, Claude reads/writes it through one MCP connector, and the engine keeps the wiki tidy and pulls in new sources (saved articles, life logs from phones). Read `docs/architecture.md` before larger changes.

## Layout

```
src/platform/   runtime layer (Node now, Workers later): Db, secret, clock, fetch, logger
src/core/       config, crypto, migrations, settings, connections, events (observer), registry, i18n, ip, audit
src/storage/    VaultStorage interface, path policy, SafeVault (decorator), fs / webdav adapters, factory
src/auth/       admin (setup code, sessions, TOTP), oauth (OAuth 2.1 server), ingest-tokens
src/http/       Hono surfaces: mcp (8787), ingest (8790); common middleware
src/admin/      admin UI (Hono JSX, server-rendered) incl. OAuth consent page
src/modules/    feature plugins: vault, hub, (wiki, ledger, mail, location, health, tasks …)
src/hub.ts      composition root — loads modules, builds the MCP server per request
src/main.ts     Node entry point (listeners)
test/unit · test/contract · test/integration · test/golden · test/fixtures
docs/           English docs, docs/ko Korean
```

## Commands

```bash
npm run dev        # tsx watch
npm test           # vitest
npm run typecheck
npm run build
```

## Architecture rules

1. `src/core`, `src/modules`, `src/auth`, `src/http`, `src/admin` must not import `node:*`. Runtime-specific code goes in `src/platform` or in a runtime-specific adapter injected at the entry point (CI enforces this).
2. Every external service sits behind a provider/adapter interface (Strategy). Modules never talk to a concrete service.
3. Modules touch the vault only through `SafeVault`, never a raw `VaultStorage`.
4. Modules record facts as events (`EventBus.append`) and render notes from events; they do not hand-edit notes line by line.
5. The engine knows vault **roles**, not folder names. Never hardcode a folder layout.
6. Tools: English identifiers, bilingual descriptions `T(en, ko)`, zod input, `readOnly` / `destructive` flags. Destructive tools are hidden unless enabled.
7. Keep dependencies minimal. Runtime deps today: hono, @modelcontextprotocol/sdk, zod, better-sqlite3, aws4fetch. A new one needs a reason in the PR.

## Security rules (non-negotiable)

- Never commit secrets or personal data. Fixtures are fake (masked names like `홍*동`, merchants like `Sample Cafe`, domains like `example.com`).
- No tool may send data outward: no email sending, no arbitrary URL fetching, no webhooks. Providers only call hosts configured by the admin.
- Validate every input with zod. Bound sizes (body limits, path length, query length).
- Do not log personal data (amounts, merchants, coordinates, mail or note content) or any secret. Log ids and counts.
- Secrets go only into `connections.secrets_enc` (encrypted, write-only). Tokens are stored as hashes.
- Protected paths (rule notes) must stay unwritable by tools.
- Auth changes need tests for the attack, not only the happy path.

## Tests

- Storage adapters must pass `test/contract/storage.test.ts`.
- Renderers get golden tests; parsers get fake fixtures (and fuzz cases for odd input).
- Auth/HTTP changes extend `test/integration/connector.test.ts`.

## Workflow (details: docs/development.md)

- Branch from `develop` as `<type>/<kebab-description>`; PR into `develop`; `main` is releases only.
- Conventional Commits: `feat(storage): add s3 adapter`.
- Commit identity must be the GitHub **noreply** address. **Never use GitHub's merge buttons** (squash, merge commit or rebase all record the merger's profile name and email). Merge by fast-forward: `git push origin <branch>:develop` once CI is green.
- Split large work into PRs by layer, in dependency order; each PR must build and pass tests alone. Target < 400 changed lines of code.
- After merging, check `git log --format='%an <%ae> | %cn'` for personal data.

## UI (details: docs/design.md)

Convenience first: one task per screen, recommended option first, plain words, results always confirmed. Clean and quiet: neutral grays, one accent color for the primary action, red only for errors/destructive, green only for ok. Server-rendered, bilingual, accessible.

Before you commit: `npm run typecheck && npm test`, check `git diff` for anything personal or secret, and run `gitleaks protect --staged` if available.

# Security review

A review of memexhub against a subset of **OWASP ASVS 4.0 level 2** that fits a single-user, self-hosted server. Each item names the test that proves it. Last review: P7 (2026-10). Tracking issue #67.

## Authentication and sessions (V2, V3)

| Item | Status | Proof |
|---|---|---|
| Admin passwords ≥ 12 characters, PBKDF2-SHA256 600k iterations | ✅ | `test/unit/auth.test.ts` |
| Lockout after 5 failed logins (15 min) | ✅ | `auth.test.ts › locks after repeated failures` |
| Optional TOTP; required when the admin UI is opened to the internet | ✅ / warning on the security card | `admin-wizard.test.ts › security checks` |
| First-run takeover blocked: one-time setup code from the server log; MCP and ingest refuse until an admin exists | ✅ | `connector.test.ts › unclaimed instance` |
| Session id random, stored hashed, new on every login (no fixation) | ✅ | `attacks.test.ts › new session id per login` |
| Session cookie `HttpOnly`, `SameSite=Strict`, `Secure` on https | ✅ | `attacks.test.ts` |
| CSRF token on every admin POST | ✅ | `attacks.test.ts`, `admin-recipes.test.ts` |
| Idle sessions removed after 30 days | ✅ | hub job `auth-cleanup` |

## OAuth 2.1 for Claude (V51 OAuth, RFC 9700)

| Item | Status | Proof |
|---|---|---|
| Dynamic registration only for https redirect URIs on allow-listed hosts (suffix tricks refused) | ✅ | `attacks.test.ts › refused for bad requests`, `auth.test.ts` |
| Exact redirect match at authorize and token | ✅ | `attacks.test.ts` |
| PKCE S256 required; `plain` and short challenges refused | ✅ | `attacks.test.ts` |
| Codes: one-time, 60 s, bound to client + redirect; a stolen code burns for everyone | ✅ | `attacks.test.ts › cannot be replayed …` |
| Consent needs the admin password (+TOTP); deny returns `access_denied` | ✅ | `attacks.test.ts › need the admin password` |
| Opaque tokens stored as hashes; access 1 h; refresh rotates; reuse revokes the family | ✅ | `connector.test.ts`, `auth.test.ts` |
| Tokens bound to this server's resource (audience) | ✅ | `attacks.test.ts › bound to this server's resource` |
| Revoking a client kills its tokens and future authorizations | ✅ | `attacks.test.ts › die with their client` |
| Optional: only Anthropic's outbound ranges may call `/mcp` | ✅ | `connector.test.ts › enforces the Anthropic IP allowlist` |

## Access control and input (V4, V5)

| Item | Status | Proof |
|---|---|---|
| Admin UI answers only on private networks unless explicitly opened | ✅ | `attacks.test.ts` |
| Device tokens: per device, scoped, hashed, revocable | ✅ | `auth.test.ts`, `connector.test.ts › ingest surface` |
| Every input validated with zod; body size limits per route | ✅ | ingest, recipes, import tests |
| Vault paths normalised; traversal, hidden paths and symbolic links refused | ✅ | `storage.test.ts`, `dav.test.ts` |
| Rule notes and active recipes cannot be written by tools | ✅ | `storage.test.ts`, `ledger-ingest.test.ts` |
| User-supplied regexes (recipes) checked against catastrophic backtracking | ✅ | `ledger-messages.test.ts › rejects dangerous patterns` |
| No open redirects (wizard `next` accepts step numbers only) | ✅ | `admin-wizard.test.ts` |

## Data protection and secrets (V6, V8, V9)

| Item | Status | Proof |
|---|---|---|
| Connection secrets AES-256-GCM with per-record AAD, write-only | ✅ | `crypto.test.ts`, `google-tasks.test.ts` |
| Inbox content encrypted, bound to the item, wiped when resolved, purged after N days | ✅ | `inbox.test.ts` |
| Backups encrypted; restore refuses other secrets and damaged files | ✅ | `backups.test.ts` |
| No coordinates or street numbers in notes or tool output | ✅ | `location.test.ts`, `summaries.test.ts` |
| HSTS on https; no-store caching; strict CSP (no scripts at all) on every HTML page; sandboxed WebDAV files | ✅ | `attacks.test.ts`, `dav.test.ts` |
| Outbound requests only to hosts of the connection, https, no redirects, private IPs refused unless allowed | ✅ | `providers.test.ts` |
| Logs carry ids and counts; audit never stores content | ✅ | code review |

## Prompt injection (LLM-specific)

No tool sends data outward; mail and inbox texts are marked untrusted with links removed and long numbers masked; Claude can only *propose* recipes; destructive tools are hidden unless enabled. See [security](security.md#prompt-injection).

## Accepted risks

- **Rate limits are in memory per process.** Fine for one instance; a multi-instance deployment would need a shared store.
- **`/revoke` needs no client authentication** (RFC 7009 public clients): whoever holds a token can revoke it, which only helps the owner.
- **Admin over plain http on the LAN** is allowed (the cookie then lacks `Secure`). Use an SSH tunnel or a TLS proxy if your LAN is not trusted.
- **Public OAuth clients** (no client secret) are standard for Claude connectors; PKCE + exact redirect + allow-listed hosts carry the protection.

## Supply chain (V14)

Five runtime dependencies; lockfile with `npm ci`; `npm audit` and OSV-Scanner fail CI on known vulnerabilities; CodeQL (security-extended); gitleaks over the full history on every PR; Actions pinned by commit SHA; Dependabot; base image pinned by digest; release images signed (cosign, keyless) with SBOM and provenance.

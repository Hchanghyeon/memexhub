# Claude integration

## Connecting

1. Admin UI → copy `PUBLIC_URL/mcp`.
2. Claude app → Settings → Connectors → Add custom connector → paste.
3. Your browser opens memexhub's consent page → admin login (+ 2FA) → **Allow**.

Behind the scenes (OAuth 2.1):

```
Claude ──▶ /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
Claude ──▶ POST /register                 redirect URI must be https on an allow-listed host (claude.ai, claude.com)
browser ─▶ GET/POST /authorize            admin login + consent; PKCE S256 required; exact redirect match
Claude ──▶ POST /token                    one-time 60 s code + code_verifier → access (1 h) + refresh token
Claude ──▶ POST /mcp  (Bearer)            every tool call; refresh rotates silently
```

- Tokens are **opaque random strings** stored as SHA-256 hashes — revoking a client in the admin UI takes effect immediately.
- Reusing an already-rotated refresh token revokes the whole token family (theft detection).
- With the IP allowlist on, `/mcp` only accepts Anthropic's outbound ranges, so a leaked token is useless elsewhere.
- You never copy a token. Nothing is stored on your phone.

## Engine computes, Claude judges

| Work | Who |
|---|---|
| payment/money notes, totals, tables, link checks, indexes, receipt-mail matching | engine (exact, no tokens) |
| choosing which stays become calendar events, one-line day summaries, weekly observations, wiki pages | Claude |

New tools that make routines cheap 📝:

- `day_summary(date)` — stays, payments, transit, health, mail counts in one compact call (no need to open large yearly notes)
- `week_summary(week)` — weekly numbers with week-over-week comparison
- `hub_status()` ✅ — connection health and last received records (never settings or secrets)

## Routines

Scheduled Claude routines keep their instructions in vault notes (e.g. "read `rules/nightly.md` and follow the code block"). Put those notes under **protected paths** so a prompt-injected Claude cannot rewrite tomorrow's instructions.

## Tool language

Each tool has English and Korean descriptions. Admin UI → Claude connector → *Tool description language*: `en`, `ko` or `both`.

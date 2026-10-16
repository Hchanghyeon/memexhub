# UI and UX design

The admin UI is used rarely and in a hurry: set it up once, fix a connection, revoke a token. Optimize for **finishing the task without thinking**.

## Principles

1. **Convenience first.** Every screen answers "what do I do next?". Defaults are the recommended choice; the recommended option is listed first and labelled.
2. **One task per screen.** The setup wizard is linear: one question, one action, then *Next*. No configuration the user doesn't need yet.
3. **Explain in plain words.** Labels say what happens ("Only allow Anthropic's servers to call /mcp"), not how it is implemented. Help text is one sentence.
4. **Safe by design, not by warning.** Dangerous actions are hidden or need a second step; secrets are shown once with a copy button and a clear "won't be shown again".
5. **Always confirm results.** After saving: a short success message; after a failed test: what went wrong and how to fix it.
6. **Fast and light.** A small React app (no UI framework, no router library, ~95 KB gzip) talking to a JSON API; works on a phone and in dark mode.
7. **Accessible.** Real `<label>`s, keyboard reachable, visible focus, contrast ≥ 4.5:1, never color alone to carry meaning (pair with text or an icon).
8. **Bilingual.** Every user-facing string exists in English and Korean.

## Visual style

- **Clean and quiet.** Lots of white space, one column, max width ~720 px.
- **Few colors.** Neutral grays for everything; **one accent** for the primary action; red only for errors and destructive actions; green only for "connected / ok". No gradients, no decorative color.
- **One font stack** (system UI), two weights, three sizes (title, body, small).
- **Simple components**: plain buttons (primary / secondary / danger), cards with a 1 px border, simple tables. No icons unless they add meaning.
- **Consistent wording**: *Connect*, *Test connection*, *Save*, *Revoke*, *Create token* — the same verb for the same action everywhere.

## Copy checklist

- Starts with the action or the result, not with background.
- No jargon where a plain word works ("sign in" not "authenticate").
- Errors: what happened + what to do ("Wrong setup code. Copy it from the server log and try again.").
- No exclamation marks, no blame.

## Screens

The admin UI is a React app in `web/` (Vite, TypeScript), built into `dist-web/` and served by the server under `/admin` — by the Node entry from disk, on Cloudflare Workers from static assets. It talks to the JSON API at `/admin/api` (`src/admin/api.ts`): session cookie (HttpOnly, SameSite=Strict), CSRF token in the `X-CSRF` header, private network only unless opened with two-factor. The CSP allows only the app's own scripts, styles and fonts.

| Screen | What it is for |
|---|---|
| Overview | *Getting started* checklist (required / recommended / optional), status cards, *Needs attention* |
| Vault | where notes live (current choice preselected), wiki layout, Obsidian sync |
| Claude app | how to add the connector (copy button), signed-in apps, tools |
| Devices | device tokens (scopes as checkboxes, shown once with a copy button), where to send |
| Connections | outside services with their state; add one in a dialog with the provider's own fields |
| Features | switches for optional features, each with its settings |
| Recipes & inbox | messages that could not be read, try a message, recipes |
| Activity | who connected (with IP) and what changed |
| Security · Backups | checks, two-factor, who may connect, open from outside; download, restore, import |

Every change shows a short toast with the result. Text exists in English and Korean side by side in the page code (`t("Save", "저장")`); the language follows the browser and can be switched in the menu. The OAuth consent page stays server-rendered (`src/admin/consent.tsx`) because it is part of the sign-in redirect.

Development: `npm run dev` (server on 8787) and `npm run dev:web` (Vite with hot reload, proxies `/admin/api`).

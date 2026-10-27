# UI and UX design

The admin UI is used rarely and in a hurry: set it up once, fix a connection, revoke a token. Optimize for **finishing the task without thinking**.

## Principles

1. **Convenience first.** Every screen answers "what do I do next?". Defaults are the recommended choice; the recommended option is listed first and labelled.
2. **One task per screen.** The setup wizard is linear: one question, one action, then *Next*. No configuration the user doesn't need yet.
3. **Explain in plain words.** Labels say what happens ("Only allow Anthropic's servers to call /mcp"), not how it is implemented. Help text is one sentence.
4. **Safe by design, not by warning.** Dangerous actions are hidden or need a second step; secrets are shown once with a copy button and a clear "won't be shown again".
5. **Always confirm results.** After saving: a short success message; after a failed test: what went wrong and how to fix it.
6. **Fast and light.** A small React app (shadcn/ui components, no router library) talking to a JSON API; works on a phone and in dark mode.
7. **Accessible.** Real `<label>`s, keyboard reachable, visible focus, contrast ≥ 4.5:1, never color alone to carry meaning (pair with text or an icon).
8. **Bilingual.** Every user-facing string exists in English and Korean.

## Visual style

- **Clean and quiet.** One column, lots of white space, hairline borders instead of shadows.
- **Few colors.** Neutral grays for everything; the near-black primary only for the main action; red only for errors and destructive actions; green only for "ok"; amber only for "look at this". No gradients, no decorative color.
- **Components**: [shadcn/ui](https://ui.shadcn.com) (Radix primitives + Tailwind CSS v4) copied into `web/src/components/ui/`. Icons (lucide) in navigation and where they add meaning.
- **Consistent wording**: *Connect*, *Test connection*, *Save*, *Revoke*, *Create token*: the same verb for the same action everywhere.

## Design system

Pages are built **only** from the parts in `web/src/ui/kit.tsx`. A page never sets its own margins, font sizes or colors; if something is missing, add a part to the kit and document it here. (Tailwind classes in a page are fine for one-off layout such as a two-column grid, never for spacing between blocks.)

**Tokens**

The brand tokens (colors, type, spacing, radii, motion) live in [`design/tokens.json`](../design/tokens.json) and are shared with the Android app; `npm run tokens` writes `web/src/tokens.css` (`--mx-*` variables) and the app's `Tokens.kt`. See [design/README.md](../design/README.md). The table below is the admin app's current layout scale.

| | Value |
|---|---|
| Font | Pretendard (bundled), system fallbacks |
| Type | page title 24/600 · card title 16/600 · body 14/400 (line 24) · label 14/500 · meta and hints 13/400 muted · code 13 mono |
| Spacing (4 px grid) | 8 label→control, control groups, buttons · 16 rows in a list, fields side by side · 20 blocks inside a card · 24 between cards and card padding · 32 under the page header |
| Width | content max 768 px; sidebar 240 px; phone padding 16 px |
| Radius | controls 8 px · cards and tiles 14 px · badges full |
| Elevation | none on cards (border only); popovers and dialogs only |
| Color | theme variables in `web/src/styles.css` (`--primary`, `--muted`, `--destructive`, `--success`, `--warning`); light and dark follow the device |

**Parts**

| Part | Use |
|---|---|
| `Page` | title, one-line description, optional actions; sections 24 px apart |
| `Card` | a titled block. `badge` (Required / Recommended / Optional), `aside` (one small button), `footer` (the save button(s), left-aligned on a tinted strip), `onSubmit` to make it a form |
| `List` + `Item` | rows with a status dot or icon, title + badges, a muted meta line, actions on the right, optional details below |
| `Tiles` + `Tile` | linked summary numbers, or "add one of these" choices |
| `Field`, `Input`, `TextArea`, `Select`, `Fields` | label above, hint below; `Fields` puts two side by side |
| `Toggle` | an on/off setting with a title and a one-line hint; several stack with hairlines |
| `Choice` | pick one of a few options shown at once (radio cards with a hint) |
| `Check` | a checkbox with a label and optional hint |
| `Segmented` | pick one of 2–4 short options (language, view) |
| `DateInput` | a compact date picker in page actions (label read by screen readers only) |
| `QrCode` | a QR code for a phone camera (setup links, two-factor keys) |
| `Status`, `Badge`, `Callout` | state with a dot; small labels; info / warning / error notes |
| `Steps`, `KeyValue`, `Copy`, `More`, `Sub`, `Hint`, `Empty` | numbered how-to; label → value pairs; copyable value; hidden advanced settings; a group heading inside a card; small help text; empty state |

**Rules**

- One primary button per card, in its footer. Secondary actions are `outline`, row actions are `sm`, "turn off" style actions are `ghost`.
- Required / Recommended / Optional badges sit next to the card title, not in the body.
- Status is a dot **and** a word; never color alone.
- Advanced settings go in `More`, collapsed.

## Copy checklist

- Starts with the action or the result, not with background.
- No jargon where a plain word works ("sign in" not "authenticate").
- Errors: what happened + what to do ("Wrong setup code. Copy it from the server log and try again.").
- No exclamation marks, no blame.

## Screens

The admin UI is a React app in `web/` (Vite, TypeScript), built into `dist-web/` and served by the server under `/admin`: by the Node entry from disk, on Cloudflare Workers from static assets. It talks to the JSON API at `/admin/api` (`src/admin/api.ts`): session cookie (HttpOnly, SameSite=Strict), CSRF token in the `X-CSRF` header, private network only unless opened with two-factor. The CSP allows only the app's own scripts, styles and fonts (inline styles are allowed for Radix positioning).

| Screen | What it is for |
|---|---|
| Overview | *Getting started* checklist (required / recommended / optional), status cards, *Needs attention* |
| Notes | read-only vault viewer: folder tree, full-text search, notes rendered with react-markdown + GFM, `[[wiki links]]` followed inside the viewer, callouts and frontmatter shown; raw HTML never rendered, web images shown as links |
| Vault | where notes live (current choice preselected), wiki layout, Obsidian sync |
| Claude app | how to add the connector (copy button), signed-in apps, tools |
| Devices | device tokens (scopes as checkboxes, shown once with a copy button), where to send |
| Connections | outside services with their state, edit and delete; add one by its short name in a dialog with the provider's fields, each with a label and help in both languages |
| Features | switches for optional features, each with its settings |
| Messages | messages to check, senders read by themselves, the recipe collection, what a recipe is; trying a message and JSON under Advanced |
| Activity | who connected (with IP) and what changed |
| Security · Backups | checks, two-factor, who may connect, open from outside; download, restore, import |

Every change shows a short toast with the result. Text exists in English and Korean side by side in the page code (`t("Save", "저장")`); the language follows the browser and can be switched in the menu. The OAuth consent page stays server-rendered (`src/admin/consent.tsx`) because it is part of the sign-in redirect.

Development: `npm run dev` (server on 8787) and `npm run dev:web` (Vite with hot reload, proxies `/admin/api`).

# Notion ✅ (output)

memexhub can mirror your **payments** and **health days** into Notion databases, for people who plan and review in Notion. memexhub's records stay the source of truth; Notion gets a copy every 15 minutes.

## Set up

1. notion.so/my-integrations → **New integration** (internal) → copy the secret.
2. In Notion, open the page that should hold the databases → **⋯ → Connections → add your integration**.
3. memexhub admin → Connections → *Notion*: the page link and the secret (stored encrypted).
4. Features → **Notion**: switch on payments and / or health → **Sync now** (or wait for the 15-minute job).

memexhub creates **"memexhub · Payments"** (merchant, date and time, amount, card, place, item, online, kind) and **"memexhub · Health"** (day, steps, sleep hours, resting heart rate, active kcal, workouts, summary) under that page.

## Behaviour

- **No duplicates:** each record remembers its Notion page; a re-sync only creates new rows and updates changed ones (e.g. an item added later by a receipt mail).
- Edits you make in Notion are not read back; they may be overwritten when that record changes.
- Only `api.notion.com` is contacted; rate limits are respected (≈3 requests/s, waits on 429).
- Notion is an outside service: **only the kinds you switch on** are copied. Coordinates are never sent; places are names only.


## Notion as the vault (beta)

Admin UI → Vault → **Notion**: the page link (shared with your integration) and the integration secret. memexhub creates a **"memexhub vault"** database there: one page per note, the vault path in **Path**.

- **Lossless:** reading a note gives back exactly what was written. Headings, `- ` bullets, `- [ ]` to-dos, `> ` quotes, `---`, fenced code and the frontmatter become real Notion blocks; anything else (bold, numbered lists, tables, indentation) stays as literal text in a paragraph. Pages you write in Notion are read as text too.
- **Small vaults:** Notion allows about 3 requests a second, a note is a few requests, and search reads every note. Fine for a few hundred notes; for big vaults use a folder, WebDAV or S3.
- Obsidian cannot open this vault directly: use it if you live in Notion and talk to it through Claude.

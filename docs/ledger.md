# Ledger (payments)

Your devices report payments the moment they happen (a phone automation, an app or any script that can send HTTP); the engine keeps a yearly **payments note** and a **money note** up to date. ✅

## How records arrive

| Endpoint | Typical sender | Body |
|---|---|---|
| `POST /ingest/sms` | card approval / cancellation SMS — iOS Shortcuts *Message* automation, Android Tasker / MacroDroid SMS trigger | `{ "text": "<whole SMS>", "lat"?: n, "lon"?: n }` |
| `POST /ingest/transaction` | wallet transactions — iOS Shortcuts *Transaction* automation (Apple Pay, transit cards), or any app | `{ "merchant", "amount", "card", "name", "time"?, "lat"?, "lon"?, "kind"?: "online" \| "taxi", "item"? }` |

Header `X-Ingest-Token: <device token with scope ledger>`. Bodies are limited to 4 KB, unknown fields are rejected, and rejected requests are logged without their values.

Card SMS are read by a generic parser plus small **recipes** stored as vault notes (built-in: Hyundai Card, Samsung Card). Anything unreadable waits in an inbox for Claude, who can propose a recipe — see [message recipes](recipes.md). `POST /ingest/message` 📝 accepts any channel (`sms`, `mail`, `notification`, `text`).

## iPhone setup (iOS Shortcuts)

1. Admin UI → *Device tokens* → create a token with scope `ledger`. Copy it (shown once).
2. **Card SMS** — Shortcuts → Automation → *Message* → *Sender* is your card company → *Run immediately* → add *Get Contents of URL*:
   URL `https://<your ingest host>/ingest/sms`, Method `POST`, Header `X-Ingest-Token`, Request body *JSON* with `text` = *Shortcut Input → Content*.
   Optional: add *Get Current Location* and send `lat` / `lon` — used only to name the place, never stored.
3. **Apple Pay / transit** — Automation → *Transaction* → choose cards → *Run immediately* → *Get Contents of URL* to `/ingest/transaction` with `merchant`, `amount`, `card`, `name` from the *Transaction* variables.

## Android setup

Any automation app that can react to an SMS and send an HTTP request works (e.g. Tasker, MacroDroid):
trigger *SMS received* from your card company → *HTTP request* `POST https://<your ingest host>/ingest/sms`,
header `X-Ingest-Token`, JSON body `{"text": "<SMS body>"}`. The engine does not care which device sent it.

## What the engine does

- **Dedupe**: the same amount within ±5 minutes is one payment (SMS and Apple Pay often both report it). Cancellations are never deduped.
- **Transit vs office**: transit-card taps without an amount are rides; taps at a place listed in *Office places* are office gate entries.
- **Online / recurring**: merchants like streaming services or online shops are marked 🌐 and shown without a place.
- **Late messages** (> 10 min after the payment) are shown without a place.
- **Coordinates** are only turned into a place name (when a location provider is connected) and never stored.

## Notes

| Note | Default path | Content |
|---|---|---|
| Payments | `ledger/payments/{year}.md` | month and day headings with totals, payment table, 🚇 transit line, 🏢 office line. **Redrawn on every record — don't edit by hand.** |
| Money | `ledger/money.md` | your sections (*Manual fixed costs*, *Notes*) + an **auto section**: this month, top merchants, by card, by month, recurring payments (subscriptions vs frequent places) |

Paths, note language (`en` / `ko`) and office places: Admin UI → *Features* → *Ledger*.

## Tools

| Tool | Does |
|---|---|
| `payments_day(date)` ✅ | one day's payments, totals, transit and office taps — compact |
| `payments_from_mail(date?)` 📝 | read the configured mail folders now, through the same recipes |
| `ledger_inbox` · `ledger_inbox_resolve` · `ledger_recipe_propose` · `ledger_recipes` 📝 | unreadable messages and recipes — see [message recipes](recipes.md) |

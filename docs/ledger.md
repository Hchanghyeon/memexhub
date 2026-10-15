# Ledger (payments)

Your phone reports payments the moment they happen; the engine keeps a yearly **payments note** and a **money note** up to date. ✅

## How records arrive

| Endpoint | Sent by | Body |
|---|---|---|
| `POST /ingest/sms` | iPhone Shortcuts *Message* automation (card approval / cancellation SMS) | `{ "text": "<whole SMS>", "lat"?: n, "lon"?: n }` |
| `POST /ingest/transaction` | iPhone Shortcuts *Transaction* automation (Apple Pay, Wallet transit cards) | `{ "merchant", "amount", "card", "name", "time"?, "lat"?, "lon"?, "kind"?: "online" \| "taxi", "item"? }` |

Header `X-Ingest-Token: <device token with scope ledger>`. Bodies are limited to 4 KB, unknown fields are rejected, and rejected requests are logged without their values.

Supported card SMS: Hyundai Card, Samsung Card (issuer plugins — [adding one](adding-a-provider.md#a-new-card-issuer-ledger)).

## iPhone setup

1. Admin UI → *Device tokens* → create a token with scope `ledger`. Copy it (shown once).
2. **Card SMS** — Shortcuts → Automation → *Message* → *Sender* is your card company → *Run immediately* → add *Get Contents of URL*:
   URL `https://<your ingest host>/ingest/sms`, Method `POST`, Header `X-Ingest-Token`, Request body *JSON* with `text` = *Shortcut Input → Content*.
   Optional: add *Get Current Location* and send `lat` / `lon` — used only to name the place, never stored.
3. **Apple Pay / transit** — Automation → *Transaction* → choose cards → *Run immediately* → *Get Contents of URL* to `/ingest/transaction` with `merchant`, `amount`, `card`, `name` from the *Transaction* variables.

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
| `payments_from_mail` 📝 | merge receipt mails (P4, needs a mail provider) |

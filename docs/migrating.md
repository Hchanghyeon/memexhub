# Moving from another setup

memexhub can take over from an earlier server or scripts without losing history.

1. **Install** memexhub next to the old setup ([install](install.md)) and finish the wizard with the **same vault**.
2. **Import history** — admin UI → **Import**:
   - **Payments**: JSON Lines, one record per line. Fields: `time` (ISO, required), `merchant`, `amount` (`₩12,500`, `-₩8,000`, `USD 1.00`), `card`, `name`, `place`, `item`, `kind`, `transit`, `online`, `late`, `source`. Already-computed values are kept as they are. A line with `"skipped": "merged"` and `target` (the payment's time) adds an item name to that payment. Lines already present (same time, amount, merchant) are skipped, so importing twice is safe.
   - **Health**: JSON `{ "YYYY-MM-DD": { "metrics": {...}, "sleep": {...}, "workouts": [...] } }` ([health](health.md)).
   - **Device tokens**: keep each automation's existing token (stored hashed) so you only change addresses.
3. **Check** the redrawn notes (payments, money, health) — they are rebuilt from the imported records.
4. **Switch** your automations to the new addresses (raw texts → `POST /ingest/message` with `"channel": "sms"`; structured payments → `/ingest/transaction`; health → `/ingest/health`), connect location / mail / tasks in Connections, and add the Claude connector.
5. **Run both for a few days**, compare, then turn the old setup off. Keep a [backup](configuration-and-storage.md#backups-) from before the switch.

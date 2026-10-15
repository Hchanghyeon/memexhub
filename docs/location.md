# Location ✅

Where you were, as **stays** ("10:00–10:30 · Sample Cafe"). Payments get place names from it too. Coordinates stay in the database or your location server; **the vault only ever gets names**, never coordinates or street numbers.

## Sources (connections)

| Provider | What | Setup |
|---|---|---|
| **Dawarich** | your self-hosted Dawarich server | Connections → Dawarich: URL + API key. Use an address Dawarich accepts (listed in its `APPLICATION_HOSTS`, e.g. its public https name) — Dawarich refuses other host names. Named **Areas** you draw in Dawarich ("Home", "Office") are used as place names. |
| **OwnTracks** | the OwnTracks app (or anything speaking its HTTP format) sends points to memexhub | Connections → OwnTracks; type named places, one per line: `name, latitude, longitude, radius`. In the app: Mode *HTTP*, URL `https://<ingest host>/ingest/owntracks`, *Authentication* on, any *UserID*, and a device token of scope `location` as the *Password* (memexhub accepts the token as the Basic auth password on every `/ingest/*` path; on iOS the expert setting *HTTP Headers* `X-Ingest-Token:<token>` works too). Leave *Secret encryption key* empty. Mode *Move* sends a point every `locatorInterval` (180 s) or `locatorDisplacement` (200 m) with GPS accuracy; *Significant* saves battery but its points are often 0.5–2.5 km off and are dropped. *ignoreInaccurateLocations* `500` and *downgrade* `20` (back to Significant below 20 % battery) are good defaults. Points are kept for `keepDays` (default 400). |
| **Nominatim** (place names) | OpenStreetMap reverse geocoding | Connections → Nominatim. Public server: ≤ 1 request/s, add a contact; results are cached. You can point it at your own Nominatim. |

Admin UI → Features → **Location**: which source and geocoder to use, **private places** (never written — e.g. "Home"), language.

## Names

1. Inside a named area → the area's name (private areas → nothing).
2. A station or bus stop → its name.
3. Otherwise the neighbourhood (city, district, area) without the street number.

## Stays

Points within **150 m** for **15+ minutes** form a stay; stays closer than 200 m are merged (GPS jitter); fixes worse than 1 km are dropped. The numbers are settings (`location.stay`).

## Tools

| Tool | Does |
|---|---|
| `location_day(date)` | the day's stays with names and durations, distance travelled, and (Dawarich) visits guessed by the app, flagged when they don't match a stay |

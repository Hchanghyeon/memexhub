# Health ✅

Daily numbers from your phone's health app become one line per day in a yearly **health note** (`health/{year}.md`, or `{year}-{month}` in the path for one note per month; admin UI → Features → Health). Claude reads a day with `health_day(date)`.

```
- 10-14 (Wed) 😴 23:40–06:50 · 6h 50m (deep 30 min · REM 2h 30m) · awake 1× (20 min) · steps 8,240 · 6.1 km · resting HR 58 · 🏃 Running 32 min 310 kcal
```

## Sending data — `POST /ingest/health`

Header `X-Ingest-Token` with a device token of scope `health`. Two body formats:

**1. Shortcut / any automation** — flat fields, all optional:

| Field | Example |
|---|---|
| `date` | `2026-10-14` — the day the activity belongs to (default: yesterday) |
| numbers | `steps`, `distance_km`, `flights`, `active_kcal`, `exercise_min`, `stand_hours`, `resting_hr`, `avg_hr`, `walking_hr`, `hrv`, `spo2`, `respiratory`, `vo2max`, `weight`, `body_fat`, `mindful_min`, `water_ml`, `caffeine_mg`, `daylight_min`, `headphone_db` — strings with units or commas are fine; up to 20 other `snake_case` numbers are kept as they are |
| `sleep` | one sample per line `start|end|value` (e.g. `2026-10-14 01:10|2026-10-14 01:40|Deep`) — or three lists `sleep_start`, `sleep_end`, `sleep_value` |
| `workouts` | one per line `type|start|duration|kcal` |

Sleep goes to the **day you woke up** (last night's sleep is that morning's record). Samples more than 3 hours apart are separate sleeps; the longest is last night. Without a watch (only "in bed"), the time in bed is shown.

**2. Health Auto Export app** — its REST API automation body `{ "data": { "metrics": [...], "workouts": [...] } }`. Several values a day are summed or averaged, units are converted (miles, kJ, lb, 0–1 percentages), sleep summaries or samples both work.

Sending the same date again **replaces** that date's values. Works from iOS Shortcuts, Health Auto Export, or anything else that can POST JSON (Android: Health Connect exporters, Tasker).

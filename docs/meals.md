# Meals ✅

In the Claude app, **send a photo of a meal or say what you ate**: Claude names each food, estimates the portion, calories and protein / carbs / fat, and records it. Switch it on under **Features → Meals**.

```
You: (photo) had this for lunch
Claude: I'll record jeyuk-deopbap, one portion, about 850 kcal, and doenjang soup, about 80 kcal. Did you finish the rice?
```

- **Estimates.** From a photo, expect ±20–30%; a portion in words ("half a bowl") helps. Values from a label or the restaurant are kept with `estimated: false`.
- **Note:** `meals/{year}-{month}.md` (change it under Features → Meals): a total and a table per day, redrawn by the engine.
- **Day summary:** `day_summary` gets "🍽 3 meals · 1,850 kcal · protein 80 g …", and each meal joins the **scene** it was eaten in (stay, payment), e.g. `12:20 📍 restaurant · 💳 ₩9,000 · 🍽 lunch jeyuk-deopbap 850 kcal`.
- **Week:** `week_summary` adds average intake per day and days recorded, against the week before.

| Tool | What it does |
|---|---|
| `meal_add(items, date?, time?, slot?, place?, note?, estimated?, replaces?)` | record a meal; `replaces` corrects an earlier entry |
| `meal_day(date?)` | a day's meals (with ids) and totals |
| `meal_cancel(id)` | take back an entry recorded by mistake (kept in the log, gone from the note) |

Claude records only food the owner said they ate, and never guesses meals from payments.

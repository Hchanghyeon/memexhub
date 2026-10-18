/** Meals the owner ate, as Claude estimated them from a photo or a description. Notes are redrawn from events. */
export interface FoodItem { name: string; amount?: string; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number }
export type Slot = "breakfast" | "lunch" | "dinner" | "snack" | "drink";
export interface Meal { id: string; date: string; time: string; slot: Slot; place?: string; items: FoodItem[]; note?: string; estimated: boolean }
/** What the bus stores: a meal, a correction (`replaces`), or a cancellation. */
export type MealEvent = (Meal & { replaces?: string }) | { cancel: string };

type Lang = "ko" | "en";
const SLOT: Record<Slot, { ko: string; en: string }> = {
  breakfast: { ko: "아침", en: "breakfast" }, lunch: { ko: "점심", en: "lunch" }, dinner: { ko: "저녁", en: "dinner" }, snack: { ko: "간식", en: "snack" }, drink: { ko: "음료", en: "drink" },
};
export const slotName = (s: Slot, l: Lang) => SLOT[s][l];
/** A meal's slot from the time it was eaten, when not given. */
export const slotAt = (time: string): Slot => {
  const h = Number(time.slice(0, 2));
  return h >= 5 && h < 10 ? "breakfast" : h >= 10 && h < 15 ? "lunch" : h >= 17 && h < 22 ? "dinner" : "snack";
};

/** Events in order → the meals that stand: a correction replaces its target, a cancellation removes it. */
export function mealsOf(events: MealEvent[]): Meal[] {
  const out = new Map<string, Meal>();
  for (const e of events) {
    if ("cancel" in e) { out.delete(e.cancel); continue; }
    const { replaces, ...m } = e;
    if (replaces) out.delete(replaces);
    out.set(m.id, m);
  }
  return [...out.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export interface Totals { kcal: number; protein_g: number; carbs_g: number; fat_g: number; meals: number }
export function totals(meals: Meal[]): Totals {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: meals.length };
  for (const m of meals) for (const i of m.items) { t.kcal += i.kcal; t.protein_g += i.protein_g ?? 0; t.carbs_g += i.carbs_g ?? 0; t.fat_g += i.fat_g ?? 0; }
  return t;
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const cell = (s: string) => s.replace(/\|/g, "／");
export const mealKcal = (m: Meal) => m.items.reduce((s, i) => s + i.kcal, 0);
export const what = (m: Meal) => m.items.map((i) => `${i.name}${i.amount ? ` ${i.amount}` : ""}`).join(", ");

/** "1,850 kcal · protein 80 g · carbs 220 g · fat 60 g" (macros only when some were given). */
export function totalsText(t: Totals, l: Lang) {
  const macros = t.protein_g || t.carbs_g || t.fat_g
    ? (l === "ko" ? ` · 단백질 ${int(t.protein_g)}g · 탄수화물 ${int(t.carbs_g)}g · 지방 ${int(t.fat_g)}g` : ` · protein ${int(t.protein_g)} g · carbs ${int(t.carbs_g)} g · fat ${int(t.fat_g)} g`)
    : "";
  return `${int(t.kcal)} kcal${macros}`;
}

/** The day_summary part: a total line, then one line per meal. */
export function dayLines(meals: Meal[], l: Lang): string[] {
  if (!meals.length) return [];
  const t = totals(meals);
  return [
    `🍽 ${l === "ko" ? `${t.meals}번` : `${t.meals} meal${t.meals > 1 ? "s" : ""}`} · ${totalsText(t, l)}${meals.some((m) => m.estimated) ? (l === "ko" ? " (어림)" : " (estimated)") : ""}`,
    ...meals.map((m) => `- ${m.time} ${slotName(m.slot, l)} ${what(m)}${m.place ? ` @ ${m.place}` : ""} · ${int(mealKcal(m))} kcal [${m.id}]`),
  ];
}

const DOW = { ko: "월화수목금토일", en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] };
const dow = (date: string, l: Lang) => {
  const i = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return l === "ko" ? DOW.ko[i]! : DOW.en[i]!;
};

/** The meals note for a year (or one month): one table per day, newest month last. */
export function renderMealsNote(all: Meal[], year: number, o: { lang: Lang; created: string; today: string }, month?: number): string {
  const l = o.lang;
  const ym = (m: number) => `${year}-${String(m).padStart(2, "0")}`;
  const meals = all.filter((m) => m.date.startsWith(month ? `${ym(month)}-` : `${year}-`));
  const title = month ? `${ym(month)} ${l === "ko" ? "식단" : "meals"}` : `${year} ${l === "ko" ? "식단" : "meals"}`;
  const out = [
    "---", `title: ${title}`, `created: ${o.created}`, `updated: ${o.today}`, "type: note", "tags: []", "---", "", `# ${title}`, "",
    l === "ko"
      ? "Claude가 사진이나 설명을 보고 어림한 값이라 ±20~30% 틀릴 수 있어요. **엔진이 매번 다시 그려요: 손으로 고치면 다음 기록 때 사라져요.** 고치려면 Claude에게 말하세요."
      : "Estimated by Claude from a photo or a description, so expect ±20–30%. **The engine redraws this note on every record: manual edits are lost.** Ask Claude to correct an entry.",
    "",
  ];
  const months = [...new Set(meals.map((m) => m.date.slice(0, 7)))].sort();
  for (const mk of months) {
    out.push(`## ${mk}`, "");
    const days = [...new Set(meals.filter((m) => m.date.startsWith(mk)).map((m) => m.date))].sort();
    for (const d of days) {
      const dm = meals.filter((m) => m.date === d);
      out.push(`### ${d.slice(5)} (${dow(d, l)}) · ${totalsText(totals(dm), l)}`, "");
      out.push(l === "ko" ? "| 시각 | 끼니 | 무엇 | kcal |" : "| Time | Meal | What | kcal |", "|---|---|---|---|");
      for (const m of dm) out.push(`| ${m.time} | ${slotName(m.slot, l)} | ${cell(what(m))}${m.place ? ` @ ${cell(m.place)}` : ""}${m.note ? ` · ${cell(m.note)}` : ""} | ${int(mealKcal(m))} |`);
      out.push("");
    }
  }
  if (!months.length) out.push(l === "ko" ? "아직 기록이 없어요." : "No meals yet.", "");
  return out.join("\n");
}

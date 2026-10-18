import { z } from "zod";
import { defineModule, defineTool, type DayEvent } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { randomToken } from "../../core/crypto.js";
import { localDate, nowIn, perMonth, periodPath, zonedIso } from "../../core/time.js";
import { dayLines, mealKcal, mealsOf, renderMealsNote, slotAt, slotName, totals, totalsText, what, type Meal, type MealEvent } from "./render.js";

const g = z.number().min(0).max(1000).optional();
const Item = z.object({
  name: z.string().trim().min(1).max(80).describe("Food, e.g. 제육덮밥 / bibimbap"),
  amount: z.string().trim().max(40).optional().describe("Portion, e.g. 1인분, 반 공기, 2 slices"),
  kcal: z.number().min(0).max(5000).describe("Estimated calories of this item"),
  protein_g: g, carbs_g: g, fat_g: g,
});

export default defineModule({
  id: "meals",
  title: T("Meals", "식단"),
  setup: ({ settings, bus, vault, platform }) => {
    const tz = () => settings.timezone;
    const m = () => settings.meals;
    const lang = () => m().language;
    const all = async () => mealsOf((await bus.query(["meal"])).map((e) => e.payload as MealEvent));
    const today = () => localDate(tz(), platform.now());
    const onDay = async (date: string) => (await all()).filter((x) => x.date === date);

    /** Observer: every meal event redraws that period's note. */
    bus.on("meal", async (e) => {
      if (!vault) return;
      try {
        const p = e.payload as MealEvent;
        const date = "cancel" in p ? localDate(tz(), new Date(e.occurredAt)) : p.date;
        const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
        const path = periodPath(m().note, year, month);
        const created = (await vault.stat(path)) ? ((await vault.read(path)).text.match(/^created: (.+)$/m)?.[1] ?? today()) : today();
        await vault.withActor("meals").write(path, renderMealsNote(await all(), year, { lang: lang(), created, today: today() }, perMonth(m().note) ? month : undefined));
      } catch (err) {
        platform.log.warn("meals redraw failed", { error: (err as Error).message.slice(0, 120) });
      }
    });

    const at = (date: string, time: string) => zonedIso(tz(), Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));

    return {
      summary: {
        async day(date) {
          const lines = dayLines(await onDay(date), lang());
          return lines.length ? lines : undefined;
        },
        async events(date): Promise<DayEvent[]> {
          return (await onDay(date)).map((x) => ({ kind: "meal", start: Date.parse(at(x.date, x.time)), label: `${slotName(x.slot, lang())} ${what(x)}`, amount: `${Math.round(mealKcal(x))} kcal` }));
        },
        async week(from, to) {
          const ms = (await all()).filter((x) => x.date >= from && x.date <= to);
          if (!ms.length) return undefined;
          const days = new Set(ms.map((x) => x.date)).size;
          const ko = lang() === "ko";
          return { lines: [], numbers: [{ label: ko ? "하루 평균 섭취" : "avg intake per day", value: totals(ms).kcal / days, unit: "kcal" }, { label: ko ? "식단 기록한 날" : "days with meals", value: days }] };
        },
      },
      tools: [
        defineTool({
          name: "meal_add",
          description: T(
            "Record a meal the owner ate. From a photo or a description, name each food, estimate the portion, calories and (if you can) protein / carbs / fat in grams, using typical Korean portions. Tell the owner your estimate and ask about the portion when unsure. Never record food the owner did not say they ate. To correct an entry, pass its id as `replaces` (meal_day shows ids).",
            "주인이 먹은 끼니를 기록한다. 사진이나 설명을 보고 음식마다 이름, 양, 칼로리, (가능하면) 단백질·탄수화물·지방 g 을 한국 1인분 기준으로 어림한다. 어림한 값을 주인에게 말하고, 양이 애매하면 물어본다. 주인이 먹었다고 하지 않은 음식은 기록하지 않는다. 고칠 때는 그 기록의 id 를 `replaces` 로 준다 (meal_day 에 id 가 나온다).",
          ),
          input: {
            items: z.array(Item).min(1).max(20),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: today)"),
            time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM when it was eaten (default: now)"),
            slot: z.enum(["breakfast", "lunch", "dinner", "snack", "drink"]).optional().describe("Default: from the time"),
            place: z.string().trim().max(80).optional().describe("Where, e.g. the restaurant"),
            note: z.string().trim().max(300).optional(),
            estimated: z.boolean().default(true).describe("false only when the numbers come from a label or the restaurant"),
            replaces: z.string().max(40).optional().describe("Id of an entry this one corrects"),
          },
          async run(a) {
            const n = nowIn(tz(), platform.now());
            const date = a.date ?? today();
            const time = a.time ?? `${String(n.h).padStart(2, "0")}:${String(n.mi).padStart(2, "0")}`;
            if (a.replaces && !(await all()).some((x) => x.id === a.replaces)) return `no meal with id ${a.replaces}`;
            const meal: Meal & { replaces?: string } = {
              id: randomToken("meal_").slice(0, 16), date, time, slot: a.slot ?? slotAt(time), items: a.items,
              ...(a.place ? { place: a.place } : {}), ...(a.note ? { note: a.note } : {}), estimated: a.estimated !== false, ...(a.replaces ? { replaces: a.replaces } : {}),
            };
            await bus.append({ type: "meal", occurredAt: at(date, time), source: "claude", payload: meal as any });
            const day = totals(await onDay(date));
            return `${a.replaces ? "corrected" : "recorded"} ${meal.id}: ${time} ${slotName(meal.slot, lang())} ${what(meal)} · ${Math.round(mealKcal(meal))} kcal\n${date}: ${totalsText(day, lang())}`;
          },
        }),
        defineTool({
          name: "meal_day",
          readOnly: true,
          description: T("A day's meals with ids, calories and protein / carbs / fat totals.", "하루 먹은 것(id 포함)과 칼로리, 단백질·탄수화물·지방 합계."),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: today)") },
          async run(a) {
            const date = a.date ?? today();
            const lines = dayLines(await onDay(date), lang());
            return lines.length ? `${date}\n${lines.join("\n")}` : `no meals on ${date}`;
          },
        }),
        defineTool({
          name: "meal_cancel",
          description: T("Take back a meal entry recorded by mistake (the record stays in the log, the note no longer shows it).", "잘못 기록한 끼니를 취소한다 (기록 이력은 남고 노트에서만 빠진다)."),
          input: { id: z.string().max(40) },
          async run({ id }) {
            const hit = (await all()).find((x) => x.id === id);
            if (!hit) return `no meal with id ${id}`;
            await bus.append({ type: "meal", occurredAt: at(hit.date, hit.time), source: "claude", payload: { cancel: id } as any });
            return `cancelled ${id} (${hit.date} ${hit.time} ${what(hit)})`;
          },
        }),
      ],
    };
  },
});

import { z } from "zod";
import { defineTool, type ModuleContext, type WeekNumber } from "../../core/registry.js";
import { pick, T } from "../../core/i18n.js";
import { addDays, localDate, weekdayMon0 } from "../../core/time.js";

const DOW = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ko: ["월", "화", "수", "목", "금", "토", "일"] };

/** Monday of an ISO week ("2026-W42") or of the week containing a date. */
export function weekStart(week: string): string {
  const w = week.match(/^(\d{4})-W(\d{1,2})$/);
  if (w) {
    const jan4 = `${w[1]}-01-04`;
    return addDays(addDays(jan4, -weekdayMon0(jan4)), (Number(w[2]) - 1) * 7);
  }
  return addDays(week, -weekdayMon0(week));
}
export function isoWeek(monday: string): string {
  const thu = addDays(monday, 3);
  const y = thu.slice(0, 4);
  const jan4 = `${y}-01-04`;
  const w1 = addDays(jan4, -weekdayMon0(jan4));
  return `${y}-W${String(Math.round((Date.parse(thu) - Date.parse(w1)) / 604_800_000) + 1).padStart(2, "0")}`;
}

const num = (n: WeekNumber, v = n.value) => {
  const s = v.toLocaleString("en-US", { maximumFractionDigits: n.decimals ?? 0, minimumFractionDigits: n.decimals ?? 0 });
  return n.unit === "₩" ? `₩${s}` : n.unit ? `${s} ${n.unit}` : s;
};

/** day_summary / week_summary: one call that asks every module for its part (Composite). */
export function summaryTools(ctx: ModuleContext) {
  const lang = () => (ctx.settings.toolLanguage === "ko" ? "ko" : "en");
  const safe = async <R>(fn: () => Promise<R>): Promise<R | string> => {
    try {
      return await fn();
    } catch (e) {
      return `(unavailable: ${(e as Error).message.slice(0, 100)})`;
    }
  };
  return [
    defineTool({
      name: "day_summary",
      readOnly: true,
      description: T(
        "Everything about one day in one compact call: where you were, payments, health, mail counts, tasks due. Use it for daily notes instead of opening large notes or calling each tool.",
        "하루를 한 번에 짧게: 어디 있었는지, 결제, 건강, 메일 개수, 마감 할 일. 하루 일지를 쓸 때 큰 노트를 열거나 도구를 하나씩 부르는 대신 쓴다.",
      ),
      input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: today)") },
      async run({ date }) {
        const l = lang();
        const d = date ?? localDate(ctx.settings.timezone, ctx.platform.now());
        const out = [`# ${d} (${DOW[l][weekdayMon0(d)]})`];
        for (const s of ctx.summaries()) {
          if (!s.summary.day) continue;
          const part = await safe(() => s.summary.day!(d));
          if (part === undefined || (Array.isArray(part) && !part.length)) continue;
          out.push("", `## ${pick(s.title, l)}`, ...(Array.isArray(part) ? part : [part]));
        }
        return out.length > 1 ? out.join("\n") : `${out[0]}\n${l === "ko" ? "기록 없음" : "no records"}`;
      },
    }),
    defineTool({
      name: "week_summary",
      readOnly: true,
      description: T(
        "A week's numbers compared with the week before (spending, payments, office days, distance, sleep, steps, workouts) plus top merchants and recurring payments. week: 2026-W42 or any date in the week (default: this week).",
        "한 주의 숫자를 지난주와 비교해서(지출, 결제 수, 출근일, 이동, 수면, 걸음, 운동) + 많이 쓴 곳, 정기 결제. week: 2026-W42 또는 그 주의 아무 날짜 (기본: 이번 주).",
      ),
      input: { week: z.string().regex(/^(\d{4}-W\d{1,2}|\d{4}-\d{2}-\d{2})$/).optional() },
      async run({ week }) {
        const l = lang();
        const from = weekStart(week ?? localDate(ctx.settings.timezone, ctx.platform.now()));
        const to = addDays(from, 6);
        const out = [`# ${isoWeek(from)} (${from.slice(5)} – ${to.slice(5)})`];
        for (const s of ctx.summaries()) {
          if (!s.summary.week) continue;
          const [cur, prev] = await Promise.all([safe(() => s.summary.week!(from, to)), safe(() => s.summary.week!(addDays(from, -7), addDays(to, -7)))]);
          if (!cur) continue;
          out.push("", `## ${pick(s.title, l)}`);
          if (typeof cur === "string") {
            out.push(cur);
            continue;
          }
          for (const n of cur.numbers) {
            const p = typeof prev === "object" && prev ? prev.numbers.find((x) => x.label === n.label) : undefined;
            const diff = p ? n.value - p.value : undefined;
            out.push(`- ${n.label}: ${num(n)}${diff !== undefined ? ` (${diff >= 0 ? "+" : "−"}${num(n, Math.abs(diff))} ${l === "ko" ? "지난주 대비" : "vs last week"})` : ""}`);
          }
          out.push(...cur.lines.map((x) => `- ${x}`));
        }
        return out.join("\n");
      },
    }),
  ];
}

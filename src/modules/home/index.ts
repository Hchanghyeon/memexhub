import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { dayBounds, localDate, nowIn } from "../../core/time.js";
import type { HomeProvider, LogEntry } from "../../providers/home/types.js";

const hm = (iso: string, tz: string) => {
  const p = nowIn(tz, new Date(iso));
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};
export const logLine = (e: LogEntry, tz: string) => `${hm(e.when, tz)} ${e.name} ${e.message}`.trim();
const MAX_LINES = 40;

export default defineModule({
  id: "home",
  title: T("Home", "집"),
  setup: async ({ provider, connections, settings, platform }) => {
    const names = await connections("home");
    const tz = settings.timezone;
    const homes = async () => {
      const out: { name: string; p: HomeProvider }[] = [];
      for (const n of names) {
        const p = await provider<HomeProvider>("home", n);
        if (p) out.push({ name: n, p });
      }
      return out;
    };
    const none = "no smart-home connection — admin UI → Connections → Home Assistant";
    return {
      summary: {
        async day(date) {
          const [from, to] = dayBounds(tz, date);
          const lines: string[] = [];
          for (const { name, p } of await homes()) {
            if (!p.summaryEntities.length) continue;
            try {
              const rows: LogEntry[] = [];
              for (const e of p.summaryEntities) rows.push(...(await p.logbook(from, to, e)));
              rows.sort((a, b) => a.when.localeCompare(b.when));
              lines.push(...rows.slice(0, 20).map((r) => logLine(r, tz)), ...(rows.length > 20 ? [`… +${rows.length - 20}`] : []));
            } catch (e) {
              lines.push(`${name}: unavailable (${(e as Error).message.slice(0, 120)})`);
            }
          }
          return lines.length ? lines : undefined;
        },
      },
      tools: [
        defineTool({
          name: "home_states",
          readOnly: true,
          description: T(
            "Current state of smart-home devices and sensors (lights, doors, temperature, people at home …). Filter by text in the id or name. Read-only.",
            "스마트홈 기기·센서의 지금 상태 (조명·문·온도·재실 …). id나 이름의 글자로 거른다. 읽기 전용.",
          ),
          input: { filter: z.string().max(80).optional(), limit: z.number().int().min(1).max(200).default(60) },
          async run({ filter, limit }) {
            const hs = await homes();
            if (!hs.length) return none;
            const q = (filter ?? "").toLowerCase();
            const out: string[] = [];
            for (const { name, p } of hs) {
              const st = (await p.states()).filter((s) => !q || s.entity.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
              out.push(`${name}: ${st.length} entities${st.length > limit ? ` (first ${limit})` : ""}`, ...st.slice(0, limit).map((s) => `- ${s.name} [${s.entity}]: ${s.state}${s.changed ? ` · since ${localDate(tz, new Date(s.changed))} ${hm(s.changed, tz)}` : ""}`));
            }
            return out.join("\n");
          },
        }),
        defineTool({
          name: "home_day",
          readOnly: true,
          description: T(
            "What happened at home on a day (Home Assistant logbook: doors, lights, arrivals …), optionally for one entity. Default: today.",
            "그날 집에서 있었던 일 (홈 어시스턴트 로그북: 문·조명·귀가 …), 기기 하나만 볼 수도 있다. 기본은 오늘.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), entity: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/).optional() },
          async run({ date, entity }) {
            const hs = await homes();
            if (!hs.length) return none;
            const d = date ?? localDate(tz, platform.now());
            const [from, to] = dayBounds(tz, d);
            const out: string[] = [];
            for (const { name, p } of hs) {
              const rows = await p.logbook(from, to, entity);
              out.push(`${name} · ${d}: ${rows.length} entries${rows.length > MAX_LINES ? ` (last ${MAX_LINES})` : ""}`, ...rows.slice(-MAX_LINES).map((r) => `- ${logLine(r, tz)}`));
            }
            return out.join("\n");
          },
        }),
      ],
    };
  },
});

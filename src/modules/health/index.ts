import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { nowIn } from "../../core/time.js";
import { fromHealthAutoExport, fromShortcut, type DayUpdate } from "./parse.js";
import { dayLine, mergeDays, renderHealthNote } from "./render.js";

const Body = z.record(z.string().max(40), z.unknown()).refine((o) => Object.keys(o).length <= 80, "too many fields");

export default defineModule({
  id: "health",
  title: T("Health", "건강"),
  setup: ({ settings, bus, vault, platform }) => {
    const tz = () => settings.timezone;
    const h = () => settings.health;
    const days = async () =>
      mergeDays((await bus.query(["health"])).map((e) => e.payload as { date: string; update: DayUpdate }));
    const today = () => {
      const n = nowIn(tz(), platform.now());
      return `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
    };

    /** Observer: health events redraw that year's note. */
    bus.on("health", async (e) => {
      if (!vault) return;
      try {
        const year = Number(String((e.payload as { date: string }).date).slice(0, 4));
        const path = h().note.replace("{year}", String(year));
        const created = (await vault.stat(path)) ? ((await vault.read(path)).text.match(/^created: (.+)$/m)?.[1] ?? today()) : today();
        await vault.withActor("health").write(path, renderHealthNote(await days(), year, { lang: h().language, created, today: today() }));
      } catch (err) {
        platform.log.warn("health redraw failed", { error: (err as Error).message.slice(0, 120) });
      }
    });

    return {
      tools: [
        defineTool({
          name: "health_day",
          readOnly: true,
          description: T(
            "One day of health records: last night's sleep, steps, activity, heart rate, workouts — one compact line.",
            "하루치 건강 기록: 지난밤 잠, 걸음, 활동, 심박, 운동 — 한 줄로.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD") },
          async run({ date }) {
            const r = (await days()).get(date);
            return r ? dayLine(date, r, h().language) : `no health records on ${date}`;
          },
        }),
      ],
      ingest: [
        {
          // iOS Shortcuts (flat numbers + sleep + workouts) or the Health Auto Export app ({ data: {...} }).
          path: "/ingest/health",
          scope: "health",
          maxBytes: 512 * 1024,
          async handle(body) {
            const p = Body.safeParse(body);
            if (!p.success) throw new Error("invalid payload");
            const data = p.data.data;
            const updates =
              data && typeof data === "object" && !Array.isArray(data)
                ? fromHealthAutoExport(data as Record<string, unknown>, tz(), platform.now())
                : fromShortcut(p.data, tz(), platform.now());
            const dates = Object.keys(updates).sort().slice(-400);
            for (const date of dates)
              await bus.append({ type: "health", occurredAt: new Date(`${date}T12:00:00Z`).toISOString(), source: data ? "health-auto-export" : "shortcut", payload: { date, update: updates[date] } as any });
            return { days: dates.length, dates: dates.slice(-10) };
          },
        },
      ],
    };
  },
});

import { z } from "zod";
import type { EventBus } from "../../core/events.js";

/** Health days from a previous setup: { "YYYY-MM-DD": { metrics?, sleep?, workouts? } }. Same date again = replaced. */
const Day = z
  .object({
    metrics: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.number()).optional(),
    sleep: z.record(z.string().max(20), z.union([z.string().max(10), z.number(), z.boolean()])).optional(),
    workouts: z.array(z.object({ type: z.string().max(30), start: z.string().max(5).optional(), min: z.number().optional(), kcal: z.number().optional() })).max(10).optional(),
  })
  .strip();
export const HealthDays = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), Day).refine((o) => Object.keys(o).length <= 20_000, "too many days");

export async function importHealthDays(bus: EventBus, text: string): Promise<{ added: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  const p = HealthDays.safeParse(raw);
  if (!p.success) throw new Error(`not health days: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`);
  const list = Object.entries(p.data).sort(([a], [b]) => a.localeCompare(b)).map(([date, update]) => ({
    type: "health",
    occurredAt: new Date(`${date}T12:00:00Z`).toISOString(),
    source: "import",
    payload: { date, update } as Record<string, unknown>,
  }));
  return { added: list.length ? await bus.appendMany(list) : 0 };
}

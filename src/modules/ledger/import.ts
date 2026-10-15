import { z } from "zod";
import type { EventBus } from "../../core/events.js";

/**
 * Ledger records from a previous setup, one JSON object per line. Already-computed fields (place, online,
 * late, transit) are kept as they are — the coordinates they came from are gone. Rows already present
 * (same time, amount and merchant) are skipped, so importing twice adds nothing.
 */
const s = z.string().max(300).optional();
const Row = z
  .object({
    time: z.string().refine((v) => !isNaN(Date.parse(v)), "time must be ISO"),
    merchant: s, amount: s, card: s, name: s, place: s, item: s, kind: s, source: s,
    transit: z.boolean().optional(), online: z.boolean().optional(), late: z.boolean().optional(),
    skipped: z.string().max(40).nullable().optional(),
    target: z.string().max(80).optional(), // for "merged" rows: the payment an item belongs to
  })
  .passthrough();

export async function importLedgerLines(bus: EventBus, text: string): Promise<{ added: number; skipped: number; invalid: number[] }> {
  const lines = text.split(/\r?\n/).slice(0, 200_000);
  const key = (time: string, amount = "", merchant = "") => `${new Date(time).toISOString()}|${amount}|${merchant}`;
  const have = new Set((await bus.query(["ledger"], { includeSkipped: true })).map((e) => key(e.occurredAt, String(e.payload.amount ?? ""), String(e.payload.merchant ?? ""))));
  const add: Parameters<EventBus["appendMany"]>[0] = [];
  const invalid: number[] = [];
  let skipped = 0;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = line.length <= 8192 ? JSON.parse(line) : undefined;
    } catch {
      raw = undefined;
    }
    const p = Row.safeParse(raw);
    if (!p.success) {
      if (invalid.length < 20) invalid.push(i + 1);
      continue;
    }
    const r = p.data;
    const k = key(r.time, r.amount, r.merchant);
    if (have.has(k)) {
      skipped++;
      continue;
    }
    have.add(k);
    const clean = (v?: string) => (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\[\[/g, "[").replace(/\]\]/g, "]").trim().slice(0, 200);
    add.push({
      type: "ledger",
      occurredAt: new Date(r.time).toISOString(),
      source: "import",
      payload: {
        merchant: clean(r.merchant), amount: clean(r.amount), card: clean(r.card), name: clean(r.name), place: clean(r.place), item: clean(r.item),
        kind: clean(r.kind), transit: !!r.transit, online: !!r.online, late: !!r.late, source: clean(r.source) || "import",
        // A legacy target is the payment's time; times are stored as UTC ISO here, so the target is too.
        ...(r.target ? { target: isNaN(Date.parse(r.target)) ? clean(r.target) : new Date(r.target).toISOString() } : {}),
      },
      // Item merges (receipt → payment) stay merges; any other skip marker becomes "duplicate".
      skipped: r.skipped === "merged" ? "merged" : r.skipped ? "duplicate" : null,
    });
  }
  return { added: add.length ? await bus.appendMany(add) : 0, skipped, invalid };
}

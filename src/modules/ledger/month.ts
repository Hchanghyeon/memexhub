import { entries, krw, normMerchant, type LedgerRow } from "./render.js";

export interface MonthReport {
  month: string; // "2026-10"
  total: number; // ₩, cancellations subtracted
  count: number; // payments (cancellations not counted)
  /** The month before, up to the same day of the month when this month is still running. */
  before: { month: string; total: number; upToDay: number | null };
  days: { date: string; total: number; count: number }[]; // every day of the month
  merchants: { name: string; total: number; count: number }[]; // top 10
  cards: { name: string; total: number }[];
  recurring: { name: string; amount: string; date: string }[];
  largest: { date: string; name: string; amount: string }[]; // top 5
  online: number; // ₩ paid online
  foreign: number; // payments in another currency (not in the totals)
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** One month of payments for the admin money page, computed from ledger events (exact, no notes read). */
export function monthReport(rows: LedgerRow[], o: { tz: string; officePlaces: string[]; year: number; month: number; today?: { y: number; m: number; d: number } }): MonthReport {
  const all = entries(rows, o.tz, o.officePlaces).filter((e) => e.kind2 === "pay");
  const inMonth = (y: number, m: number, upTo?: number) => all.filter((e) => e.w.y === y && e.w.m === m && (upTo === undefined || e.w.d <= upTo));
  const sum = (es: typeof all) => es.reduce((s, e) => s + (krw(e.amount) ?? 0), 0);
  const name = (e: (typeof all)[number]) => e.merchant || e.name || "?";
  const date = (e: (typeof all)[number]) => `${e.w.y}-${pad(e.w.m)}-${pad(e.w.d)}`;

  const cur = inMonth(o.year, o.month);
  const running = o.today && o.today.y === o.year && o.today.m === o.month;
  const [py, pm] = o.month === 1 ? [o.year - 1, 12] : [o.year, o.month - 1];
  const upToDay = running ? Math.min(o.today!.d, daysIn(py, pm)) : null;

  const days = Array.from({ length: daysIn(o.year, o.month) }, (_, i) => {
    const es = cur.filter((e) => e.w.d === i + 1);
    return { date: `${o.year}-${pad(o.month)}-${pad(i + 1)}`, total: sum(es), count: es.filter((e) => (krw(e.amount) ?? 0) > 0).length };
  });

  const group = (key: (e: (typeof all)[number]) => string, label: (e: (typeof all)[number]) => string) => {
    const by = new Map<string, { name: string; total: number; count: number }>();
    for (const e of cur) {
      const v = krw(e.amount);
      if (v === null) continue;
      const k = key(e);
      const x = by.get(k) ?? { name: label(e), total: 0, count: 0 };
      x.total += v;
      if (v > 0) x.count++;
      by.set(k, x);
    }
    return [...by.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  };

  // Recurring: the same merchant and amount 25–35 days earlier.
  const recurring = cur.filter((e) => (krw(e.amount) ?? 0) > 0 && all.some((x) => x !== e && x.amount === e.amount && normMerchant(name(x)) === normMerchant(name(e)) && e.ms - x.ms >= 25 * 86_400_000 && e.ms - x.ms <= 35 * 86_400_000));

  return {
    month: `${o.year}-${pad(o.month)}`,
    total: sum(cur),
    count: cur.filter((e) => (krw(e.amount) ?? 0) > 0).length,
    before: { month: `${py}-${pad(pm)}`, total: sum(inMonth(py, pm, upToDay ?? undefined)), upToDay },
    days,
    merchants: group((e) => normMerchant(name(e)), name).slice(0, 10).map((x) => ({ name: x.name, total: x.total, count: x.count })),
    cards: group((e) => e.card || "-", (e) => e.card || "-").map((x) => ({ name: x.name, total: x.total })),
    recurring: recurring.map((e) => ({ name: name(e), amount: e.amount ?? "", date: date(e) })),
    largest: cur.filter((e) => (krw(e.amount) ?? 0) > 0).sort((a, b) => krw(b.amount)! - krw(a.amount)!).slice(0, 5).map((e) => ({ date: date(e), name: name(e), amount: e.amount ?? "" })),
    online: sum(cur.filter((e) => e.online)),
    foreign: cur.filter((e) => krw(e.amount) === null && e.amount).length,
  };
}

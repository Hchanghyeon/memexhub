import type { DayEvent, Summary } from "../../core/registry.js";
import { addDays, localDate } from "../../core/time.js";
import { entries, krw, normMerchant, type LedgerRow } from "./render.js";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const hm = (w: { h: number; mi: number }) => `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;

/** Payments for day_summary / week_summary, computed from ledger events (exact, no notes read). */
export function ledgerSummary(o: { rows: () => Promise<LedgerRow[]>; tz: () => string; officePlaces: () => string[]; lang: () => "ko" | "en" }): Summary {
  const load = async (from: string, to: string) => {
    const tz = o.tz();
    const all = entries(await o.rows(), tz, o.officePlaces());
    return { all, inRange: all.filter((e) => { const d = localDate(tz, new Date(e.ms)); return d >= from && d <= to; }) };
  };
  return {
    async day(date) {
      const ko = o.lang() === "ko";
      const { inRange } = await load(date, date);
      if (!inRange.length) return undefined;
      const pays = inRange.filter((e) => e.kind2 === "pay");
      const total = pays.reduce((s, e) => s + (krw(e.amount) ?? 0), 0);
      const out = [ko ? `${pays.length}건 · 합계 ₩${fmt(total)}` : `${pays.length} payments · total ₩${fmt(total)}`];
      for (const e of pays) out.push(`- ${hm(e.w)} ${e.merchant || e.name || "?"}${e.place && !e.online ? ` @ ${e.place}` : ""} ${e.amount ?? ""}${e.card ? ` (${e.card})` : ""}${e.item ? ` · ${e.item}` : ""}`);
      const transit = inRange.filter((e) => e.kind2 === "transit");
      if (transit.length) out.push(`🚇 ${transit.map((e) => hm(e.w)).join(", ")}`);
      const office = inRange.filter((e) => e.kind2 === "office");
      if (office.length) out.push(`🏢 ${hm(office[0]!.w)}–${hm(office[office.length - 1]!.w)} · ${office.length}`);
      return out;
    },
    async events(date) {
      const { inRange } = await load(date, date);
      const out: DayEvent[] = inRange
        .filter((e) => e.kind2 === "pay" || e.kind2 === "transit")
        .map((e) => (e.kind2 === "pay" ? { kind: "pay", start: e.ms, label: e.merchant || e.name || "?", amount: e.amount, online: !!e.online } : { kind: "transit", start: e.ms, label: e.merchant || e.name || "" }));
      const office = inRange.filter((e) => e.kind2 === "office");
      if (office.length) out.push({ kind: "office", start: office[0]!.ms, end: office[office.length - 1]!.ms, label: o.lang() === "ko" ? "회사" : "office", named: true });
      return out;
    },
    async week(from, to) {
      const ko = o.lang() === "ko";
      const { all, inRange } = await load(from, to);
      const pays = inRange.filter((e) => e.kind2 === "pay" && krw(e.amount) !== null);
      const total = pays.reduce((s, e) => s + krw(e.amount)!, 0);
      const count = pays.filter((e) => krw(e.amount)! > 0).length;
      const officeDays = new Set(inRange.filter((e) => e.kind2 === "office").map((e) => localDate(o.tz(), new Date(e.ms)))).size;
      const by = new Map<string, { who: string; v: number }>();
      for (const e of pays) {
        const who = e.merchant || e.name || "?";
        const x = by.get(normMerchant(who)) ?? { who, v: 0 };
        x.v += krw(e.amount)!;
        by.set(normMerchant(who), x);
      }
      const top = [...by.values()].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
      // Recurring: the same merchant and amount about a month earlier (25–35 days).
      const recurring = pays.filter((e) => {
        const d = localDate(o.tz(), new Date(e.ms));
        return all.some((x) => x.kind2 === "pay" && x.amount === e.amount && normMerchant(x.merchant || x.name || "") === normMerchant(e.merchant || e.name || "") && (() => { const xd = localDate(o.tz(), new Date(x.ms)); return xd >= addDays(d, -35) && xd <= addDays(d, -25); })());
      });
      const lines: string[] = [];
      if (top.length) lines.push(`${ko ? "많이 쓴 곳" : "top"}: ${top.map((x) => `${x.who} ₩${fmt(x.v)}`).join(" · ")}`);
      if (recurring.length) lines.push(`${ko ? "정기 결제" : "recurring"}: ${recurring.map((e) => `${e.merchant || e.name} ${e.amount}`).join(" · ")}`);
      return {
        lines,
        numbers: [
          { label: ko ? "지출" : "spent", value: total, unit: "₩" },
          { label: ko ? "결제" : "payments", value: count },
          { label: ko ? "출근일" : "office days", value: officeDays },
        ],
      };
    },
  };
}

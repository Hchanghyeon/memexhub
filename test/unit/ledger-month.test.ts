import { describe, expect, it } from "vitest";
import { monthReport } from "../../src/modules/ledger/month.js";

const p = (time: string, merchant: string, amount: string, extra: object = {}) => ({ time, merchant, amount, card: "샘플카드", ...extra });
const ROWS = [
  p("2026-09-05T12:00:00+09:00", "Sample Cafe", "₩5,000"),
  p("2026-09-12T09:00:00+09:00", "Sample Stream", "₩13,900", { online: true }),
  p("2026-09-25T12:00:00+09:00", "Sample Mart", "₩40,000"),
  p("2026-10-03T12:00:00+09:00", "Sample Cafe", "₩6,000"),
  p("2026-10-03T19:00:00+09:00", "Sample Cafe", "₩4,000"),
  p("2026-10-10T09:00:00+09:00", "Sample Stream", "₩13,900", { online: true }),
  p("2026-10-11T10:00:00+09:00", "Sample Mart", "₩30,000", { card: "다른카드" }),
  p("2026-10-11T11:00:00+09:00", "Sample Mart", "-₩10,000", { card: "다른카드" }),
  p("2026-10-12T11:00:00+09:00", "Sample Shop", "USD 20.00"),
  { time: "2026-10-12T12:00:00+09:00", merchant: "Sample Cafe", amount: "₩9,999", skipped: "duplicate" },
];

describe("money page: one month", () => {
  it("adds up the month, compares with the same days of the month before, and groups by place and card", () => {
    const r = monthReport(ROWS, { tz: "Asia/Seoul", officePlaces: [], year: 2026, month: 10, today: { y: 2026, m: 10, d: 20 } });
    expect(r.total).toBe(6000 + 4000 + 13900 + 30000 - 10000);
    expect(r.count).toBe(4); // the cancellation is not a payment; the foreign one has no ₩ amount
    expect(r.before).toEqual({ month: "2026-09", total: 5000 + 13900, upToDay: 20 }); // 09-25 is after day 20
    expect(r.days).toHaveLength(31);
    expect(r.days[2]).toEqual({ date: "2026-10-03", total: 10000, count: 2 });
    expect(r.merchants.map((x) => [x.name, x.total, x.count])).toEqual([["Sample Mart", 20000, 1], ["Sample Stream", 13900, 1], ["Sample Cafe", 10000, 2]]);
    expect(r.cards).toEqual([{ name: "샘플카드", total: 23900 }, { name: "다른카드", total: 20000 }]);
    expect(r.recurring).toEqual([{ name: "Sample Stream", amount: "₩13,900", date: "2026-10-10" }]);
    expect(r.largest[0]).toEqual({ date: "2026-10-11", name: "Sample Mart", amount: "₩30,000" });
    expect(r.online).toBe(13900);
    expect(r.foreign).toBe(1);
  });

  it("compares a past month with the whole month before", () => {
    const r = monthReport(ROWS, { tz: "Asia/Seoul", officePlaces: [], year: 2026, month: 10, today: { y: 2026, m: 11, d: 2 } });
    expect(r.before).toEqual({ month: "2026-09", total: 58900, upToDay: null });
  });
});

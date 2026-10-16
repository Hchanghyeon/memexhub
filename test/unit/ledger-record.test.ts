import { beforeEach, describe, expect, it } from "vitest";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { EventBus } from "../../src/core/events.js";
import { Ledger } from "../../src/modules/ledger/record.js";

let bus: EventBus;
const NOW = new Date("2026-10-15T03:00:00Z");
const mk = (extra: any = {}) => new Ledger(bus, { officePlaces: ["Office"], now: () => NOW, ...extra });
beforeEach(async () => {
  const db = sqliteDb(":memory:");
  await migrate(db);
  bus = new EventBus(db);
});
const all = async () => (await bus.query(["ledger"], { includeSkipped: true })).map((e) => ({ ...(e.payload as any), skipped: e.skipped }));

describe("Ledger.record", () => {
  it("records a payment and dedupes the same amount within 5 minutes", async () => {
    const l = mk();
    expect((await l.record({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card A", time: "2026-10-15T11:58:00+09:00" })).duplicate).toBe(false);
    expect((await l.record({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card A", time: "2026-10-15T12:01:00+09:00" })).duplicate).toBe(true);
    expect((await l.record({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card A", time: "2026-10-15T12:20:00+09:00" })).duplicate).toBe(false);
    expect((await l.record({ merchant: "Sample Cafe", amount: "-₩4,500", card: "Card A 취소", time: "2026-10-15T12:21:00+09:00" })).duplicate).toBe(false);
    expect((await all()).filter((x) => x.skipped === "duplicate")).toHaveLength(1);
  });

  it("classifies transit, office and online; detects late messages", async () => {
    const l = mk({ places: { placeAt: async () => "Office" } });
    expect((await l.record({ name: "Tmoney", time: NOW.toISOString() })).kind).toBe("office");
    const l2 = mk({ places: { placeAt: async () => "Sample Station" } });
    expect((await l2.record({ name: "Tmoney", time: NOW.toISOString() })).kind).toBe("transit");
    await l.record({ merchant: "Netflix", amount: "₩9,900", card: "Card", time: "2026-10-01T00:00:00Z" });
    const rows = await all();
    const nf = rows.find((r) => r.merchant === "Netflix");
    expect(nf.online).toBe(true);
    expect(nf.late).toBe(true);
    expect(rows.find((r) => r.place === "Sample Station").transit).toBe(true);
  });

  it("uses coordinates only to name the place and never stores them", async () => {
    const l = mk({ places: { nameAt: async (lat: number) => (lat > 0 ? "Sample Plaza" : undefined) } });
    await l.record({ merchant: "Shop", amount: "₩1,000", lat: 37.1, lon: 127.1, time: NOW.toISOString() });
    const row = (await all())[0];
    expect(row.place).toBe("Sample Plaza");
    expect(JSON.stringify(row)).not.toContain("37.1");
  });

  it("cleans fields and rejects empty or unexpected payloads", async () => {
    const l = mk();
    await l.record({ merchant: "Evil\n[[CLAUDE]]", amount: "₩1", time: NOW.toISOString() });
    expect((await all())[0].merchant).toBe("Evil [CLAUDE]");
    await expect(l.record({})).rejects.toThrow();
    await expect(l.record({ merchant: "x", extra: "nope" } as any)).rejects.toThrow();
    await expect(l.record({ merchant: "x".repeat(201) })).rejects.toThrow();
  });
});

describe("which unrecognised mails reach the inbox", () => {
  it("keeps payment-looking mail and drops ads and newsletters", async () => {
    const { looksLikePayment } = await import("../../src/modules/ledger/mail-job.js");
    expect(looksLikePayment("샘플몰 주문 확인", "합계 15,000원")).toBe(true);
    expect(looksLikePayment("Your receipt from Sample", "Total $12.00\nUnsubscribe")).toBe(true);
    expect(looksLikePayment("알림", "카드 결제 15,000원 승인")).toBe(true);
    expect(looksLikePayment("(광고) 결제 혜택 안내", "15,000원 할인")).toBe(false);
    expect(looksLikePayment("[광고] 세일", "구매 시 15,000원")).toBe(false);
    expect(looksLikePayment("이번 주 소식", "지금 구매하면 9,900원\n수신거부")).toBe(false);
    expect(looksLikePayment("이번 주 소식", "신상 9,900원")).toBe(false);
    expect(looksLikePayment(undefined, "")).toBe(false);
  });
});

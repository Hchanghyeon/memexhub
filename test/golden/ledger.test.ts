import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderMoney, renderPaymentsBody, renderPaymentsNote, replaceAutoSection, moneySkeleton, type LedgerRow } from "../../src/modules/ledger/render.js";

/** Golden files: the reference implementation's output, regenerated from the fake fixture after it was changed (2026-10). */
const rows: LedgerRow[] = readFileSync("test/fixtures/ledger/transactions.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const o = { tz: "Asia/Seoul", officePlaces: ["회사"], lang: "ko" as const, now: new Date("2026-10-16T14:30:00Z") };

describe("ledger rendering (golden)", () => {
  it("payments note body matches", () => {
    expect(renderPaymentsBody(rows, 2026, o)).toBe(readFileSync("test/golden/payments-2026.ko.md", "utf8"));
  });
  it("money auto section matches", () => {
    expect(renderMoney(rows, o)).toBe(readFileSync("test/golden/money.ko.md", "utf8"));
  });
  it("renders English and a full note with frontmatter", () => {
    const en = renderPaymentsNote(rows, 2026, { ...o, lang: "en" });
    expect(en).toContain("title: 2026 payments");
    expect(en).toContain("## 2026-10 — 6 paid · ₩74,710 · 2 cancelled");
    expect(en).toContain("🏢 09:04 – 18:20 · 2 gate taps");
    expect(renderMoney(rows, { ...o, lang: "en" })).toContain("**Subscriptions & fixed costs**");
  });
  it("only replaces the auto section", () => {
    const note = moneySkeleton("ko", "[[payments]]", "2026-10-16").replace("## 메모\n", "## 메모\n\n내가 쓴 메모\n");
    const once = replaceAutoSection(note, "AUTO 1");
    const twice = replaceAutoSection(once, "AUTO 2");
    expect(twice).toContain("내가 쓴 메모");
    expect(twice).toContain("AUTO 2");
    expect(twice).not.toContain("AUTO 1");
    expect(replaceAutoSection("no markers", "X")).toContain("<!-- memexhub:auto id=money -->\nX\n<!-- /memexhub:auto -->");
  });
});

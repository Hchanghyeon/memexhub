import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCardSms, SmsParseError } from "../../src/modules/ledger/sms.js";
import { zonedIso } from "../../src/core/time.js";

const cases: { name: string; text: string }[] = JSON.parse(readFileSync("test/fixtures/sms/cases.json", "utf8"));
const expected: Record<string, any> = JSON.parse(readFileSync("test/fixtures/sms/expected.json", "utf8"));
const opts = { tz: "Asia/Seoul", now: new Date("2026-10-15T03:00:00Z") };

describe("card SMS parsing (matches the reference implementation)", () => {
  for (const c of cases)
    it(c.name, () => {
      const exp = expected[c.name];
      if (exp.error) expect(() => parseCardSms(c.text, opts)).toThrow(SmsParseError);
      else {
        const r = parseCardSms(c.text, opts);
        expect({ merchant: r.merchant, amount: r.amount, card: r.card, time: r.time }).toEqual(exp);
      }
    });

  it("rolls the year back for December messages read in January", () => {
    const r = parseCardSms("현대카드 M 승인\n홍*동\n1,000원 일시불\n12/31 23:50\n샘플\n", { tz: "Asia/Seoul", now: new Date("2027-01-01T01:00:00Z") });
    expect(r.time).toBe("2026-12-31T23:50:00+09:00");
  });

  it("never stores card digits", () => {
    expect(parseCardSms(cases.find((c) => c.name === "samsung-merchant-on-time-line")!.text, opts).card).not.toMatch(/\d{4}/);
  });

  it("survives random input (fuzz)", () => {
    const alphabet = ["현대카드", "삼성1234", "승인", "취소", "원", "누적", "\n", "12/31", "23:59", " ", "1,000", "CNY", "님", "[현대카드]", "*", "개월", "x"];
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: Math.floor(rnd() * 30) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      try {
        const r = parseCardSms(s, opts);
        expect(typeof r.amount).toBe("string");
      } catch (e) {
        expect(e).toBeInstanceOf(SmsParseError);
      }
    }
    expect(() => parseCardSms("x".repeat(100_000), opts)).toThrow(SmsParseError);
  });

  it("builds zoned ISO times", () => {
    expect(zonedIso("Asia/Seoul", 2026, 10, 14, 20, 56)).toBe("2026-10-14T20:56:00+09:00");
    expect(zonedIso("UTC", 2026, 1, 2, 3, 4)).toBe("2026-01-02T03:04:00+00:00");
  });
});

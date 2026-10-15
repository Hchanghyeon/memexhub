import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MessageReader, loadRecipes, testRecipe } from "../../src/modules/ledger/messages/reader.js";
import { BUILTIN_RECIPES, builtinSource } from "../../src/modules/ledger/messages/builtin.js";
import { compileRecipe, unsafePattern, type CompiledRecipe } from "../../src/modules/ledger/messages/recipe.js";
import { zonedIso } from "../../src/core/time.js";

const cases: { name: string; text: string }[] = JSON.parse(readFileSync("test/fixtures/sms/cases.json", "utf8"));
const expected: Record<string, any> = JSON.parse(readFileSync("test/fixtures/sms/expected.json", "utf8"));
const NOW = new Date("2026-10-15T03:00:00Z");
const builtins = BUILTIN_RECIPES.map((r) => compileRecipe(r));
const reader = (recipes: CompiledRecipe[] = builtins, now = NOW) => new MessageReader(() => recipes, { tz: () => "Asia/Seoul", now: () => now });
const sms = (text: string) => ({ channel: "sms" as const, text });

describe("card messages with built-in recipes (same output as the P3 parser)", () => {
  for (const c of cases)
    it(c.name, async () => {
      const exp = expected[c.name];
      const r = await reader().read(sms(c.text));
      if (exp.error) expect(r.confident).toBe(false);
      else {
        expect(r.step).toBe("recipe");
        expect({ merchant: r.payment!.merchant, amount: r.payment!.amount, card: r.payment!.card, time: r.payment!.time }).toEqual(exp);
      }
    });

  it("rolls the year back for December messages read in January", async () => {
    const r = await reader(builtins, new Date("2027-01-01T01:00:00Z")).read(sms("현대카드 M 승인\n홍*동\n1,000원 일시불\n12/31 23:50\n샘플\n"));
    expect(r.payment!.time).toBe("2026-12-31T23:50:00+09:00");
  });

  it("never stores card digits", async () => {
    const r = await reader().read(sms(cases.find((c) => c.name === "samsung-merchant-on-time-line")!.text));
    expect(r.payment!.card).not.toMatch(/\d{4}/);
  });

  it("survives random input (fuzz)", async () => {
    const alphabet = ["현대카드", "삼성1234", "승인", "취소", "원", "누적", "\n", "12/31", "23:59", " ", "1,000", "CNY", "님", "[현대카드]", "*", "개월", "x", "신한카드"];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const rd = reader();
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: Math.floor(rnd() * 30) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("") || "x";
      const r = await rd.read(sms(s));
      if (r.confident) expect(r.payment!.amount).toMatch(/^-?(₩|[A-Z]{3} )/);
    }
    expect((await rd.read(sms("x".repeat(100_000)))).confident).toBe(false);
  });

  it("builds zoned ISO times", () => {
    expect(zonedIso("Asia/Seoul", 2026, 10, 14, 20, 56)).toBe("2026-10-14T20:56:00+09:00");
    expect(zonedIso("UTC", 2026, 1, 2, 3, 4)).toBe("2026-01-02T03:04:00+00:00");
  });
});

describe("generic parser without a recipe", () => {
  it("records an unknown card company when everything is found", async () => {
    const r = await reader().read(sms("[Web발신]\n샘플카드(1234) 승인\n홍*동\n7,700원 일시불\n10/14 08:10\n샘플베이커리"));
    expect(r).toMatchObject({ step: "generic", confident: true, payment: { merchant: "샘플베이커리", amount: "₩7,700", card: "샘플카드 일시불" } });
  });
  it("only guesses when something is missing", async () => {
    const r = await reader().read(sms("이번 달 이용 금액은 350,000원 입니다"));
    expect(r.confident).toBe(false);
    expect(r.reason).toMatch(/time/);
  });
});

describe("recipes", () => {
  it("every built-in recipe passes its own examples", async () => {
    for (const c of builtins) expect(await testRecipe(c), c.recipe.id).toEqual([]);
    expect((await loadRecipes([builtinSource])).errors).toEqual([]);
  });

  it("rejects dangerous or broken patterns", () => {
    for (const p of ["(a+)+$", "(\\w*)*", "(x{2,})+", "(a)\\1", "(?<n>a)\\k<n>", "(?<=" + "a".repeat(30) + ")b", "[", "a".repeat(301)]) expect(unsafePattern(p), p).toBeDefined();
    for (const p of ["(?<amount>[\\d,]+)원", "^현대\\s+\\S.*(?:승인|취소)", "(?:ab)+", "(?<!누적)\\d"]) expect(unsafePattern(p), p).toBeUndefined();
    expect(() => compileRecipe({ id: "x.bad", match: { any: ["(a+)+"] } })).toThrow(/nested/);
    expect(() => compileRecipe({ id: "x.empty", match: {} })).toThrow(/at least one condition/);
    expect(() => compileRecipe({ id: "x.many", match: { any: Array(21).fill("a") } })).toThrow();
  });

  it("extracts with named groups and templates; extra groups are never stored", async () => {
    const shop = compileRecipe({
      id: "kr.sample-shop.mail",
      channels: ["mail"],
      kind: "item",
      match: { from: "@shop\\.example\\.com$", subject: "주문" },
      extract: ["상품명:\\s*(?<item>.+)", "결제금액:\\s*(?<amount>[\\d,]+)원", "주문번호:\\s*(?<order>\\d+)"],
      set: { merchant: "샘플샵" },
      generic: false,
    });
    const r = await reader([shop]).read({ channel: "mail", from: "noreply@shop.example.com", subject: "주문 완료", text: "상품명: 샘플 머그컵\n결제금액: 12,000원\n주문번호: 99887766" });
    expect(r).toMatchObject({ step: "recipe", kind: "item", confident: true, payment: { merchant: "샘플샵", amount: "₩12,000", item: "샘플 머그컵" } });
    expect(JSON.stringify(r)).not.toContain("99887766");
    expect((await reader([shop]).read({ channel: "sms", text: "상품명: x\n결제금액: 1원" })).step).not.toBe("recipe"); // wrong channel
  });

  it("ignore recipes drop messages; failing examples disable a recipe", async () => {
    const ads = compileRecipe({ id: "kr.ads", match: { any: ["\\(광고\\)"] }, kind: "ignore" });
    expect((await reader([ads, ...builtins]).read(sms("(광고) 현대카드 승인 이벤트 10,000원"))).kind).toBe("ignore");
    const broken = { id: "kr.broken", match: { any: ["샘플"] }, set: { card: "샘플카드" }, examples: [{ text: "샘플 승인 1,000원 10/14 12:00 가게", expect: { card: "다른카드" } }] };
    const { active, errors } = await loadRecipes([builtinSource, { id: "vault", list: () => [broken, { id: "kr.samsung.sms", enabled: false, match: { any: ["삼성"] } }] }]);
    expect(errors.map((e) => e.id)).toEqual(["kr.broken"]);
    expect(active.map((c) => c.recipe.id)).toContain("kr.hyundai.sms");
    expect(active.map((c) => c.recipe.id)).not.toContain("kr.samsung.sms"); // the vault note switched samsung off
  });
});

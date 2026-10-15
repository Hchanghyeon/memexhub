import { z } from "zod";
import { CHANNELS, type Message, type ReadPayment, type ReadResult } from "./types.js";
import { genericRead, MAX_TEXT, zonedFromParts } from "./generic.js";

/**
 * Recipes: what differs per sender (card company, shop, app) as data, never code. See docs/recipes.md.
 * JavaScript regexes cannot be interrupted, so every pattern is checked before it is compiled.
 */
export const PATTERN_MAX = 300;
export const PATTERNS_PER_RECIPE = 20;
export const ACTIVE_RECIPES_MAX = 200;

/** Returns why a pattern is unsafe, or undefined. */
export function unsafePattern(src: string): string | undefined {
  if (src.length > PATTERN_MAX) return `longer than ${PATTERN_MAX} characters`;
  if (/\\[1-9]|\\k</.test(src)) return "backreferences are not allowed";
  for (const m of src.matchAll(/\(\?<[=!]((?:[^()\\]|\\.)*)\)/g)) if (m[1]!.length > 20) return "lookbehind longer than 20 characters";
  // a group that ends in a quantifier and is itself repeated: (a+)+  (\w*)*  (x{2,})+
  if (/[+*}]\)[+*{]/.test(src) || /[+*}]\)\?[+*{]/.test(src)) return "nested quantifiers are not allowed";
  try {
    new RegExp(src, "m");
  } catch (e) {
    return `invalid: ${(e as Error).message.slice(0, 80)}`;
  }
  return undefined;
}

const Pattern = z.string().min(1).superRefine((s, ctx) => {
  const why = unsafePattern(s);
  if (why) ctx.addIssue({ code: "custom", message: `pattern ${JSON.stringify(s.slice(0, 40))}: ${why}` });
});
const Patterns = z.array(Pattern).max(PATTERNS_PER_RECIPE).default([]);
const ExpectSchema = z.object({ merchant: z.string(), amount: z.string(), card: z.string(), time: z.string(), item: z.string() }).partial().strict();

export const RecipeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9._-]{3,64}$/, "id: 3–64 of a-z 0-9 . _ -"),
    name: z.string().max(100).optional(),
    version: z.number().int().positive().optional(),
    channels: z.array(z.enum(CHANNELS)).min(1).default(["sms"]),
    match: z
      .object({ from: Pattern.optional(), subject: Pattern.optional(), any: Patterns, all: Patterns, none: Patterns })
      .strict()
      .refine((m) => m.from || m.subject || m.any.length || m.all.length, "match needs at least one condition (from, subject, any or all)"),
    kind: z.enum(["payment", "item", "ignore"]).default("payment"),
    extract: Patterns,
    cancel: Pattern.optional(),
    set: z.object({ merchant: z.string().max(100), card: z.string().max(100), item: z.string().max(100) }).partial().strict().default({}),
    generic: z.boolean().default(true),
    enabled: z.boolean().default(true),
    examples: z
      .array(z.object({ channel: z.enum(CHANNELS).optional(), from: z.string().max(200).optional(), subject: z.string().max(300).optional(), text: z.string().min(1).max(MAX_TEXT), expect: ExpectSchema }).strict())
      .max(20)
      .default([]),
  })
  .strict()
  .refine((r) => r.match.any.length + r.match.all.length + r.match.none.length + r.extract.length <= PATTERNS_PER_RECIPE, `at most ${PATTERNS_PER_RECIPE} patterns per recipe`);
export type Recipe = z.output<typeof RecipeSchema>;
export type RecipeInput = z.input<typeof RecipeSchema>;

export interface CompiledRecipe {
  recipe: Recipe;
  from?: RegExp;
  subject?: RegExp;
  any: RegExp[];
  all: RegExp[];
  none: RegExp[];
  extract: RegExp[];
  cancel?: RegExp;
}

const re = (s: string) => new RegExp(s, "m");
export function compileRecipe(input: unknown): CompiledRecipe {
  const recipe = RecipeSchema.parse(input);
  return {
    recipe,
    from: recipe.match.from ? re(recipe.match.from) : undefined,
    subject: recipe.match.subject ? re(recipe.match.subject) : undefined,
    any: recipe.match.any.map(re),
    all: recipe.match.all.map(re),
    none: recipe.match.none.map(re),
    extract: recipe.extract.map(re),
    cancel: recipe.cancel ? re(recipe.cancel) : undefined,
  };
}

export function matches(c: CompiledRecipe, m: Message, text: string) {
  if (!c.recipe.enabled || !c.recipe.channels.includes(m.channel ?? "text")) return false;
  if (c.from && !c.from.test(m.from ?? "")) return false;
  if (c.subject && !c.subject.test(m.subject ?? "")) return false;
  if (c.any.length && !c.any.some((r) => r.test(text))) return false;
  if (!c.all.every((r) => r.test(text))) return false;
  return !c.none.some((r) => r.test(text));
}

/** "현대카드 {product}" → "현대카드 M"; missing groups and extra spaces disappear. */
export const fill = (tpl: string, g: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => g[k] ?? "").replace(/\s+/g, " ").trim();

function money(value: string, currency: string | undefined, cancel: boolean) {
  const v = value.replace(/\s/g, "");
  const cur = (currency ?? "").trim().toUpperCase();
  const base = !cur || cur === "원" || cur === "KRW" || cur === "₩" ? `₩${v}` : `${cur} ${v}`;
  return (cancel ? "-" : "") + base;
}

export interface ReadContext {
  tz: string;
  now?: Date;
  noise: RegExp[];
}

/** Apply one recipe that already matched. */
export function applyRecipe(c: CompiledRecipe, m: Message, text: string, ctx: ReadContext): ReadResult {
  const r = c.recipe;
  if (r.kind === "ignore") return { step: "recipe", recipeId: r.id, kind: "ignore", confident: true };
  const g: Record<string, string> = {};
  for (const x of c.extract) {
    const hit = x.exec(text);
    for (const [k, v] of Object.entries(hit?.groups ?? {})) if (v !== undefined && !(k in g)) g[k] = v.trim();
  }
  const gen = r.generic ? genericRead(text, { tz: ctx.tz, now: ctx.now, noise: ctx.noise, cancel: c.cancel }) : undefined;
  const cancel = gen?.cancel ?? (c.cancel ?? /취소/).test(text);
  const amount = g.amount ? money(g.amount, g.currency, cancel) : (gen?.amount ?? "");
  const time =
    g.month && g.day && g.hour && g.minute
      ? zonedFromParts(ctx.tz, ctx.now, +g.month, +g.day, +g.hour, +g.minute, g.year ? +g.year : undefined)
      : (gen?.time ?? "");
  const plan = cancel ? "" : (g.plan ?? gen?.plan ?? "");
  const baseCard = (r.set.card !== undefined ? fill(r.set.card, g) : g.card) || gen?.cardWord || "";
  const payment: ReadPayment = {
    merchant: (r.set.merchant !== undefined ? fill(r.set.merchant, g) : g.merchant) || gen?.merchant || (r.kind === "payment" ? "가맹점 없음" : ""),
    amount,
    card: [baseCard, plan, cancel ? "취소" : ""].filter(Boolean).join(" "),
    time,
    item: ((r.set.item !== undefined ? fill(r.set.item, g) : g.item) ?? "").slice(0, 200),
  };
  if (!amount) return { step: "recipe", recipeId: r.id, kind: r.kind, confident: false, payment, reason: "no amount" };
  return { step: "recipe", recipeId: r.id, kind: r.kind, confident: true, payment };
}

import type { Message, ReadResult } from "./types.js";
import { genericRead, MAX_TEXT } from "./generic.js";
import { ACTIVE_RECIPES_MAX, applyRecipe, compileRecipe, matches, type CompiledRecipe, type Recipe } from "./recipe.js";

/** Where recipes come from: built-in JSON now, vault notes next. Later sources override earlier ones by id. */
export interface RecipeSource {
  id: string;
  list(): Promise<unknown[]> | unknown[];
}

const MAIL_TEXT = 16_000;

/**
 * Chain of responsibility: active recipes in order → generic parser → nothing (inbox).
 * The generic result is only trusted when amount, time, an approval/cancel word and a card name were all found.
 */
export class MessageReader {
  constructor(
    private recipes: () => CompiledRecipe[] | Promise<CompiledRecipe[]>,
    private o: { tz: () => string; now?: () => Date },
  ) {}

  async read(m: Message): Promise<ReadResult> {
    const text = (m.text ?? "").replace(/\r/g, "").slice(0, m.channel === "mail" ? MAIL_TEXT : MAX_TEXT);
    const all = (await this.recipes()).filter((c) => c.recipe.enabled).slice(0, ACTIVE_RECIPES_MAX);
    const ctx = { tz: this.o.tz(), now: this.o.now?.(), noise: all.flatMap((c) => c.any) };
    for (const c of all) if (matches(c, m, text)) return applyRecipe(c, m, text, ctx);

    const g = genericRead(text, { tz: ctx.tz, now: ctx.now, noise: ctx.noise });
    if (!g.amount) return { step: "none", kind: "payment", confident: false, reason: "no amount" };
    const payment = {
      merchant: g.merchant || "가맹점 없음",
      amount: g.amount,
      card: [g.cardWord, g.cancel ? "" : g.plan, g.cancel ? "취소" : ""].filter(Boolean).join(" "),
      time: g.time,
      item: "",
    };
    const missing = [!g.time && "time", !(g.approval || g.cancel) && "approval or cancellation", !g.cardWord && "card name"].filter(Boolean);
    if (missing.length) return { step: "generic", kind: "payment", confident: false, payment, reason: `no recipe; generic parser missing ${missing.join(", ")}` };
    return { step: "generic", kind: "payment", confident: true, payment };
  }
}

/** Merge sources by id (later wins), compile, and keep the reason for every recipe that failed. */
export async function loadRecipes(sources: RecipeSource[]): Promise<{ active: CompiledRecipe[]; errors: { id: string; source: string; error: string }[] }> {
  const byId = new Map<string, { source: string; raw: unknown }>();
  for (const s of sources) for (const raw of await s.list()) byId.set(String((raw as { id?: unknown })?.id ?? `?${byId.size}`), { source: s.id, raw });
  const active: CompiledRecipe[] = [];
  const errors: { id: string; source: string; error: string }[] = [];
  for (const [id, { source, raw }] of byId) {
    try {
      const c = compileRecipe(raw);
      const failed = await testRecipe(c);
      if (failed.length) errors.push({ id, source, error: `example ${failed[0]!.index + 1} failed: ${failed[0]!.diff}` });
      else if (c.recipe.enabled) active.push(c);
    } catch (e) {
      errors.push({ id, source, error: (e as Error).message.slice(0, 300) });
    }
  }
  return { active, errors };
}

/** Run a recipe's own examples. Times are checked only when the example lists one. */
export async function testRecipe(c: CompiledRecipe, tz = "Asia/Seoul", now = new Date("2026-10-15T03:00:00Z")) {
  const reader = new MessageReader(() => [c], { tz: () => tz, now: () => now });
  const failed: { index: number; diff: string }[] = [];
  for (const [index, ex] of c.recipe.examples.entries()) {
    const r = await reader.read({ channel: ex.channel ?? c.recipe.channels[0], from: ex.from, subject: ex.subject, text: ex.text });
    if (r.step !== "recipe") {
      failed.push({ index, diff: "the recipe did not match" });
      continue;
    }
    for (const [k, want] of Object.entries(ex.expect)) {
      const got = (r.payment as unknown as Record<string, string> | undefined)?.[k] ?? "";
      if (got !== want) {
        failed.push({ index, diff: `${k}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}` });
        break;
      }
    }
  }
  return failed;
}

export type { Recipe };

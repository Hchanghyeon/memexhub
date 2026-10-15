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

/**
 * Merge sources by id: later sources override earlier ones (vault over built-in). If an override is broken
 * (invalid, unsafe or failing its examples) the next one down is used, so a bad edit never stops recording.
 */
export async function loadRecipes(
  sources: RecipeSource[],
): Promise<{ active: CompiledRecipe[]; errors: { id: string; source: string; path?: string; error: string }[] }> {
  const byId = new Map<string, { source: string; raw: Record<string, unknown> }[]>();
  for (const s of sources)
    for (const raw of await s.list()) {
      const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : `(no id #${byId.size + 1})`;
      byId.set(id, [{ source: s.id, raw: r }, ...(byId.get(id) ?? [])]);
    }
  const active: CompiledRecipe[] = [];
  const errors: { id: string; source: string; path?: string; error: string }[] = [];
  for (const [id, candidates] of byId) {
    for (const { source, raw } of candidates) {
      const path = typeof raw.__path === "string" ? raw.__path : undefined;
      const fail = (error: string) => errors.push({ id, source, ...(path ? { path } : {}), error: error.slice(0, 300) });
      if (typeof raw.__error === "string") {
        fail(raw.__error);
        continue;
      }
      try {
        const c = compileRecipe(Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("__"))));
        const failed = await testRecipe(c);
        if (failed.length) {
          fail(`example ${failed[0]!.index + 1} failed: ${failed[0]!.diff}`);
          continue;
        }
        if (c.recipe.enabled) active.push({ ...c, source, ...(path ? { path } : {}) });
        break;
      } catch (e) {
        fail((e as Error).message);
      }
    }
  }
  return { active, errors };
}

/** Run a recipe's own examples. Times are checked only when the example lists one. */
export async function testRecipe(c: CompiledRecipe, tz = "Asia/Seoul", now = new Date("2026-10-15T03:00:00Z")) {
  // Examples test the recipe itself, so a switched-off recipe is tested as if it were on.
  const on: CompiledRecipe = { ...c, recipe: { ...c.recipe, enabled: true } };
  const reader = new MessageReader(() => [on], { tz: () => tz, now: () => now });
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

import hyundai from "../../../../recipes/kr.hyundai.sms.json" with { type: "json" };
import samsung from "../../../../recipes/kr.samsung.sms.json" with { type: "json" };
import kcp from "../../../../recipes/kr.kcp.mail.json" with { type: "json" };
import kicc from "../../../../recipes/kr.kicc.mail.json" with { type: "json" };
import type { RecipeSource } from "./reader.js";

/**
 * The recipe collection: JSON files in /recipes, offered in the admin UI and switched on per install
 * (settings.recipePacks). Adding one there also needs a line here (bundlers need static imports).
 */
export const BUILTIN_RECIPES: unknown[] = [hyundai, samsung, kcp, kicc];
const idOf = (r: unknown) => (r as { id?: string }).id ?? "";
export const builtinSource = (on: () => string[]): RecipeSource => ({ id: "built-in", list: () => BUILTIN_RECIPES.filter((r) => on().includes(idOf(r))) });

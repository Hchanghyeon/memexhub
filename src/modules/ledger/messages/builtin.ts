import hyundai from "../../../../recipes/kr.hyundai.sms.json" with { type: "json" };
import samsung from "../../../../recipes/kr.samsung.sms.json" with { type: "json" };
import type { RecipeSource } from "./reader.js";

/** Built-in recipes: JSON files in /recipes. Adding one there also needs a line here (bundlers need static imports). */
export const BUILTIN_RECIPES: unknown[] = [hyundai, samsung];
export const builtinSource: RecipeSource = { id: "built-in", list: () => BUILTIN_RECIPES };

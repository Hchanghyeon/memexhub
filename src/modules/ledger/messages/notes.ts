import type { SafeVault } from "../../../storage/safe-vault.js";
import type { RecipeSource } from "./reader.js";

/**
 * Recipes as vault notes (docs/recipes.md). The engine reads only the ```json memexhub-recipe block;
 * ```text blocks followed by ```json memexhub-expect blocks are examples (= tests).
 */
const FENCE = /^```([^\n]*)\n([\s\S]*?)^```\s*$/gm;

export class RecipeNoteError extends Error {}

export function parseRecipeNote(text: string): Record<string, unknown> {
  const blocks = [...text.matchAll(FENCE)].map((m) => ({ info: m[1]!.trim(), body: m[2]! }));
  const main = blocks.filter((b) => b.info === "json memexhub-recipe");
  if (main.length !== 1) throw new RecipeNoteError(main.length ? "more than one memexhub-recipe block" : "no ```json memexhub-recipe block");
  let recipe: unknown;
  try {
    recipe = JSON.parse(main[0]!.body);
  } catch (e) {
    throw new RecipeNoteError(`recipe block is not valid JSON: ${(e as Error).message.slice(0, 80)}`);
  }
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) throw new RecipeNoteError("recipe block must be a JSON object");
  const r = { ...(recipe as Record<string, unknown>) };
  const title = text.match(/^# (.+)$/m)?.[1]?.trim();
  if (!r.name && title) r.name = title.slice(0, 100);
  const examples: unknown[] = Array.isArray(r.examples) ? [...r.examples] : [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const b = blocks[i]!;
    const next = blocks[i + 1]!;
    if (b.info === "text" && next.info === "json memexhub-expect") {
      try {
        examples.push({ text: b.body.replace(/\n$/, ""), expect: JSON.parse(next.body) });
      } catch {
        throw new RecipeNoteError(`example ${examples.length + 1}: expect block is not valid JSON`);
      }
    }
  }
  r.examples = examples;
  return r;
}

/** Renders a recipe (and its examples) as a note. Used by proposals and the admin UI. */
export function recipeNote(recipe: Record<string, unknown>, description = ""): string {
  const { examples, ...rest } = recipe as { examples?: { text: string; expect: unknown }[] } & Record<string, unknown>;
  const title = String(rest.name ?? rest.id ?? "recipe");
  const ex = (examples ?? []).map((e) => "```text\n" + e.text + "\n```\n```json memexhub-expect\n" + JSON.stringify(e.expect) + "\n```").join("\n\n");
  return [
    "---\ntype: recipe\n---",
    `# ${title}`,
    description.trim() || "Message recipe for memexhub: see docs/recipes.md.",
    "```json memexhub-recipe\n" + JSON.stringify(rest, null, 2) + "\n```",
    ...(ex ? ["## Examples", ex] : []),
  ].join("\n\n") + "\n";
}

/** Notes directly inside `dir` (not in sub-folders such as `proposed/`). */
export const notesIn = <F extends { path: string }>(files: F[], dir: string): F[] =>
  files.filter((f) => f.path.endsWith(".md") && f.path.startsWith(`${dir}/`) && !f.path.slice(dir.length + 1).includes("/"));

/**
 * Vault recipes, re-read only when a note in the folder changed. A broken note becomes an entry with an
 * `__error` so the loader reports it instead of silently skipping.
 */
export function vaultRecipeSource(vault: () => SafeVault | undefined, dir: () => string, sub?: string): RecipeSource & { signature(): Promise<string> } {
  let cache: { sig: string; items: unknown[] } | undefined;
  const folder = () => (sub ? `${dir()}/${sub}` : dir());
  const files = async () => {
    const v = vault();
    if (!v) return [];
    try {
      return notesIn(await v.list(folder()), folder());
    } catch {
      return [];
    }
  };
  const sigOf = (fs: { path: string; size: number; mtime: Date; etag?: string }[]) => fs.map((f) => `${f.path}:${f.size}:${+f.mtime}:${f.etag ?? ""}`).sort().join("|");
  return {
    id: sub ? `vault:${sub}` : "vault",
    async signature() {
      return sigOf(await files());
    },
    async list() {
      const fs = await files();
      const sig = sigOf(fs);
      if (cache?.sig === sig) return cache.items;
      const v = vault()!;
      const items: unknown[] = [];
      for (const f of fs) {
        try {
          items.push({ ...parseRecipeNote((await v.read(f.path)).text), __path: f.path });
        } catch (e) {
          items.push({ id: f.path, __path: f.path, __error: (e as Error).message });
        }
      }
      cache = { sig, items };
      return items;
    },
  };
}

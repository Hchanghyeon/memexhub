import type { Context } from "hono";
import type { Hub } from "../hub.js";

export type Lang = "en" | "ko";
export type Tr = (en: string, ko: string) => string;

/** Language for server-rendered pages (the OAuth consent page): the admin setting, or the browser's when "auto". */
export async function langOf(hub: Hub, c: Context): Promise<Lang> {
  const set = (await hub.settings.get()).admin.language;
  if (set === "en" || set === "ko") return set;
  return /^\s*ko\b/i.test(c.req.header("accept-language") ?? "") ? "ko" : "en";
}
export const tr = (l: Lang): Tr => (en, ko) => (l === "ko" ? ko : en);

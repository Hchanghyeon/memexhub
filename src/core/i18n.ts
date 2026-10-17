export type Lang = "en" | "ko" | "both";
export interface Text {
  en: string;
  ko: string;
}
export const T = (en: string, ko: string): Text => ({ en, ko });

export function pick(t: Text, lang: Lang): string {
  if (lang === "en") return t.en;
  if (lang === "ko") return t.ko;
  return `${t.en}\n${t.ko}`;
}

/**
 * A form field's text in both languages, attached with zod `.meta(F(...))`: a short label and, when it helps,
 * a hint under it (where to find the value, an example, what happens if it is left empty).
 */
export interface FieldText { description: string; ko: string; hintEn?: string; hintKo?: string; [key: string]: unknown }
export const F = (en: string, ko: string, hint?: [string, string]): FieldText => ({ description: en, ko, ...(hint ? { hintEn: hint[0], hintKo: hint[1] } : {}) });

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

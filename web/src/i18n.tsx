import { createContext, useContext } from "react";

export type Lang = "en" | "ko";
/** Inline bilingual text: t("Save", "저장"). Both languages sit next to each other in the page code. */
export type T = (en: string, ko: string) => string;
export const LangContext = createContext<{ lang: Lang; t: T; setLanguage: (l: "en" | "ko") => void }>({ lang: "en", t: (en) => en, setLanguage: () => {} });
export const useT = () => useContext(LangContext);
export const pickLang = (setting: string | undefined): Lang =>
  setting === "en" || setting === "ko" ? setting : navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
export const makeT = (l: Lang): T => (en, ko) => (l === "ko" ? ko : en);

/** "3 min ago" / "3분 전"; a date after a week. */
export function ago(t: T, when: string | null | undefined, tz: string, now = Date.now()): string {
  if (!when) return t("not yet", "아직 없음");
  const d = new Date(when);
  const s = Math.max(0, Math.round((now - +d) / 1000));
  if (s < 60) return t("just now", "방금");
  const m = Math.round(s / 60);
  if (m < 60) return t(`${m} min ago`, `${m}분 전`);
  const h = Math.round(m / 60);
  if (h < 24) return t(`${h} h ago`, `${h}시간 전`);
  const days = Math.round(h / 24);
  if (days < 7) return t(`${days} d ago`, `${days}일 전`);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short" }).format(d);
}
export const when = (v: string | null | undefined, tz: string) =>
  v ? new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—";

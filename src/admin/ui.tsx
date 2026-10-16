/** @jsxImportSource hono/jsx */
import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";

export type Lang = "en" | "ko";
/** Inline bilingual text: t("Save", "저장"). Keeps both languages next to each other in the page code. */
export type Tr = (en: string, ko: string) => string;

/** Admin UI language: the setting, or the browser's preference when it is "auto". */
export async function langOf(hub: Hub, c: Context): Promise<Lang> {
  const set = (await hub.settings.get()).admin.language;
  if (set === "en" || set === "ko") return set;
  return /^\s*ko\b/i.test(c.req.header("accept-language") ?? "") ? "ko" : "en";
}
export const tr = (l: Lang): Tr => (en, ko) => (l === "ko" ? ko : en);

export const PAGES = [
  ["/", "Overview", "개요"],
  ["/vault", "Vault", "볼트"],
  ["/connections", "Connections", "연결"],
  ["/features", "Features", "기능"],
  ["/ledger/recipes", "Recipes & inbox", "레시피·대기함"],
  ["/claude", "Claude", "Claude"],
  ["/devices", "Devices", "기기"],
  ["/security", "Security", "보안"],
  ["/activity", "Activity", "활동"],
  ["/backups", "Backups", "백업"],
] as const;

/** Builds the signed-in page frame for a mount prefix. Every admin page goes through this. */
export function pageFrame(hub: Hub, B: string) {
  return async (c: Context, o: { title: [string, string]; active: string; flash?: { ok?: string; err?: string }; children: (t: Tr, lang: Lang) => Child }) => {
    const lang = await langOf(hub, c);
    const t = tr(lang);
    const ok = (o.flash ? o.flash.ok : c.req.query("ok"))?.slice(0, 300);
    const err = (o.flash ? o.flash.err : c.req.query("err"))?.slice(0, 300);
    const nav = (
      <header class="top">
        <div class="top-in">
          <a class="brand" href={B || "/"}>memexhub</a>
          <span class="lang">{lang === "ko" ? <a href={`${B}/lang?to=en`}>English</a> : <a href={`${B}/lang?to=ko`}>한국어</a>}</span>
          <nav class="tabs" aria-label={t("Sections", "메뉴")}>
            {PAGES.map(([path, en, ko]) => (
              <a href={`${B}${path}`} aria-current={o.active === path ? "page" : undefined}>{t(en, ko)}</a>
            ))}
          </nav>
        </div>
      </header>
    );
    return c.html(
      <Layout title={`${t(...o.title)} · memexhub`} lang={lang} nav={nav} flash={{ ok, err }}>
        {o.children(t, lang)}
      </Layout>,
    );
  };
}
export type PageFrame = ReturnType<typeof pageFrame>;

/** Redirect back to a page with a one-line result ("Saved."). */
export const back = (c: Context, B: string, path: string, msg: { ok?: string; err?: string }) => {
  const q = new URLSearchParams(Object.entries(msg).filter(([, v]) => v) as [string, string][]).toString();
  return c.redirect(`${B}${path}${q ? `?${q}` : ""}`);
};

/** "3 minutes ago" / "3분 전"; absolute date after a week. */
export function ago(t: Tr, when: string | number | Date | null | undefined, now: Date, tz: string): string {
  if (when === null || when === undefined || when === "") return t("never", "없음");
  const d = new Date(when);
  if (Number.isNaN(+d)) return t("never", "없음");
  const s = Math.max(0, Math.round((+now - +d) / 1000));
  if (s < 60) return t("just now", "방금");
  const m = Math.round(s / 60);
  if (m < 60) return t(`${m} min ago`, `${m}분 전`);
  const h = Math.round(m / 60);
  if (h < 24) return t(`${h} h ago`, `${h}시간 전`);
  const days = Math.round(h / 24);
  if (days < 7) return t(`${days} d ago`, `${days}일 전`);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short" }).format(d);
}

/** A date-time in the configured time zone, "2026-10-16 08:43". */
export const when = (v: string | number | Date | null | undefined, tz: string) =>
  v ? new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—";

export const Check = (p: { name: string; checked?: boolean; value?: string; disabled?: boolean; children: Child }) => (
  <label class="check"><input type="checkbox" name={p.name} value={p.value} checked={p.checked} disabled={p.disabled} /><span>{p.children}</span></label>
);

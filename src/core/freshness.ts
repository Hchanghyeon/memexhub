import type { Db } from "../platform/types.js";
import { nowIn } from "./time.js";

/** A record source that usually arrives often enough that silence means the phone side broke. */
export interface Stale { source: "location" | "health" | "ledger"; last: string; hours: number }

/**
 * Hours of silence before a source counts as stopped. Location: the phone app is quiet while you stay put,
 * so a whole day. Health: one export a day, plus slack. Payments: a few days without a card is normal.
 */
export const EXPECT_HOURS: Record<Stale["source"], number> = { location: 24, health: 36, ledger: 96 };

/** Sources that have sent before but went quiet. Never-used sources are not reported (nothing to miss). */
export async function staleSources(db: Db, now: Date, enabled: (module: string) => boolean): Promise<Stale[]> {
  const out: Stale[] = [];
  const check = (source: Stale["source"], last: string | null | undefined) => {
    if (!last) return;
    const hours = Math.floor((+now - Date.parse(last)) / 3600_000);
    if (hours >= EXPECT_HOURS[source]) out.push({ source, last, hours });
  };
  if (enabled("location")) {
    const t = (await db.get<{ v: number | null }>(`SELECT MAX(t) AS v FROM location_points`))?.v;
    check("location", t ? new Date(t * 1000).toISOString() : null);
  }
  for (const source of ["health", "ledger"] as const) {
    if (!enabled(source)) continue;
    check(source, (await db.get<{ v: string | null }>(`SELECT MAX(received_at) AS v FROM events WHERE type = ? AND (skipped IS NULL OR skipped = 'merged')`, [source]))?.v);
  }
  return out;
}

/**
 * What the phone app may know about its own records: stopped sources, messages waiting to be
 * checked, and connections in error. Only for the token's scopes, and only counts, times and
 * connection names: never amounts, merchants, coordinates or message text.
 */
export interface DeviceStatus {
  stale: Stale[];
  inbox?: { pending: number; newest: string | null };
  connectionErrors: string[];
}

export async function deviceStatus(db: Db, now: Date, enabled: (module: string) => boolean, scopes: string[]): Promise<DeviceStatus> {
  const may = (s: string) => scopes.includes(s) || scopes.includes("*");
  const stale = (await staleSources(db, now, enabled)).filter((s) => may(s.source));
  const out: DeviceStatus = { stale, connectionErrors: [] };
  if (may("ledger") && enabled("ledger")) {
    const r = await db.get<{ n: number; newest: string | null }>(`SELECT COUNT(*) AS n, MAX(received_at) AS newest FROM inbox WHERE module = 'ledger' AND status = 'pending'`);
    out.inbox = { pending: r?.n ?? 0, newest: r?.newest ?? null };
  }
  const conns = await db.all<{ name: string }>(`SELECT name FROM connections WHERE enabled = 1 AND status = 'error' AND kind != 'storage' ORDER BY name`);
  out.connectionErrors = conns.map((c) => c.name);
  return out;
}

const NAME = { location: ["location", "위치"], health: ["health", "건강"], ledger: ["payments", "결제"] } as const;

/** "⚠ health: nothing for 2 days (last 10-18 22:03)": one line per stopped source, for tools. Times in `tz`. */
export function staleLines(list: Stale[], lang: "en" | "ko", tz: string): string[] {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return list.map((s) => {
    const n = NAME[s.source][lang === "ko" ? 1 : 0];
    const span = s.hours >= 48 ? (lang === "ko" ? `${Math.floor(s.hours / 24)}일째` : `${Math.floor(s.hours / 24)} days`) : lang === "ko" ? `${s.hours}시간째` : `${s.hours} h`;
    const t = nowIn(tz, new Date(s.last));
    const at = `${p2(t.m)}-${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}`;
    return lang === "ko" ? `⚠ ${n}: ${span} 안 들어옴 (마지막 ${at}). 폰 앱·단축어 자동화를 확인하세요.` : `⚠ ${n}: nothing for ${span} (last ${at}). Check the phone app or Shortcuts automation.`;
  });
}

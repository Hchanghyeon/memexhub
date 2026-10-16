import type { Db } from "../platform/types.js";
import { inAny } from "./ip.js";

/**
 * Who reached the server from where: sign-ins, Claude, devices — with the IP address. Separate from the audit log
 * (what changed). Repeated successful access by the same caller from the same address is kept once per window,
 * so a phone sending every few minutes does not fill the table. Rows older than KEEP_DAYS are pruned.
 * `sameNetwork` lists CIDRs that count as one address for that: Claude reaches us from a different Anthropic IP
 * on almost every request, so one app is one row per window as long as it stays inside those ranges.
 */
export type AccessKind = "admin" | "claude.authorize" | "claude.token" | "claude" | "device" | "dav";
const KEEP_DAYS = 90;

export async function recordAccess(
  db: Db,
  a: { kind: AccessKind; ip: string; ok: boolean; who?: string; detail?: string },
  o: { now?: Date; windowMinutes?: number; sameNetwork?: string[] } = {},
) {
  const now = o.now ?? new Date();
  // IPv4 seen through an IPv6 socket ("::ffff:203.0.113.5") is stored as plain IPv4.
  const ip = (a.ip || "unknown").replace(/^::ffff:(?=\d+\.)/i, "").slice(0, 64);
  const window = o.windowMinutes ?? 0;
  if (window > 0) {
    const since = new Date(+now - window * 60_000).toISOString();
    const net = o.sameNetwork?.length && inAny(ip, o.sameNetwork) ? o.sameNetwork : undefined;
    if (net) {
      const recent = await db.all<{ ip: string }>(
        `SELECT ip FROM access_log WHERE kind = ? AND ok = ? AND COALESCE(who, '') = ? AND at >= ? ORDER BY id DESC LIMIT 50`,
        [a.kind, a.ok ? 1 : 0, a.who ?? "", since],
      );
      if (recent.some((r) => inAny(r.ip, net))) return;
    } else {
      const seen = await db.get(
        `SELECT 1 FROM access_log WHERE kind = ? AND ip = ? AND ok = ? AND COALESCE(who, '') = ? AND at >= ? LIMIT 1`,
        [a.kind, ip, a.ok ? 1 : 0, a.who ?? "", since],
      );
      if (seen) return;
    }
  }
  await db.run(`INSERT INTO access_log (at, kind, who, ip, ok, detail) VALUES (?, ?, ?, ?, ?, ?)`, [
    now.toISOString(), a.kind, a.who?.slice(0, 80) ?? null, ip, a.ok ? 1 : 0, a.detail?.slice(0, 120) ?? null,
  ]);
  // Prune now and then (cheap: indexed on at).
  if (Math.random() < 0.02) await db.run(`DELETE FROM access_log WHERE at < ?`, [new Date(+now - KEEP_DAYS * 86_400_000).toISOString()]);
}

export async function listAccess(db: Db, o: { since: string; kind?: string; failedOnly?: boolean; limit?: number }) {
  return db.all<{ at: string; kind: string; who: string | null; ip: string; ok: number; detail: string | null }>(
    `SELECT at, kind, who, ip, ok, detail FROM access_log WHERE at >= ? ${o.kind ? "AND kind LIKE ?" : ""} ${o.failedOnly ? "AND ok = 0" : ""} ORDER BY id DESC LIMIT ?`,
    [o.since, ...(o.kind ? [`${o.kind}%`] : []), o.limit ?? 300],
  );
}

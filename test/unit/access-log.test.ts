import { describe, expect, it } from "vitest";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { listAccess, recordAccess } from "../../src/core/access.js";

describe("access log", () => {
  it("keeps who, kind, IP and result, once per window for repeats", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    const t0 = new Date("2026-10-16T00:00:00Z");
    const at = (m: number) => new Date(+t0 + m * 60_000);
    await recordAccess(db, { kind: "device", ip: "203.0.113.5", ok: true, who: "tok_a" }, { now: t0, windowMinutes: 60 });
    await recordAccess(db, { kind: "device", ip: "203.0.113.5", ok: true, who: "tok_a" }, { now: at(5), windowMinutes: 60 });
    await recordAccess(db, { kind: "device", ip: "::ffff:198.51.100.7", ok: true, who: "tok_a" }, { now: at(6), windowMinutes: 60 });
    await recordAccess(db, { kind: "device", ip: "203.0.113.5", ok: true, who: "tok_a" }, { now: at(61), windowMinutes: 60 });
    await recordAccess(db, { kind: "admin", ip: "203.0.113.9", ok: false, detail: "sign-in failed: x" }, { now: at(7) });
    await recordAccess(db, { kind: "admin", ip: "203.0.113.9", ok: false, detail: "sign-in failed: x" }, { now: at(8) });
    const all = await listAccess(db, { since: t0.toISOString() });
    expect(all.filter((r) => r.kind === "device")).toHaveLength(3);
    expect(all.some((r) => r.ip === "198.51.100.7")).toBe(true);
    expect(all.filter((r) => r.kind === "admin")).toHaveLength(2); // failures without a window are all kept
    expect((await listAccess(db, { since: t0.toISOString(), failedOnly: true })).every((r) => !r.ok && r.ip === "203.0.113.9")).toBe(true);
    expect(await listAccess(db, { since: t0.toISOString(), kind: "claude" })).toHaveLength(0);
  });

  it("counts one Anthropic range as one address for a Claude app, but still notes a different network", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    const t0 = new Date("2026-10-16T00:00:00Z");
    const at = (m: number) => new Date(+t0 + m * 60_000);
    const net = ["160.79.104.0/21"];
    const claude = (ip: string, m: number, who = "app_1") => recordAccess(db, { kind: "claude", ip, ok: true, who }, { now: at(m), windowMinutes: 60, sameNetwork: net });
    await claude("160.79.104.10", 0);
    await claude("160.79.105.22", 3);
    await claude("160.79.111.200", 9);
    await claude("160.79.106.1", 10, "app_2");
    await claude("203.0.113.50", 11);
    await claude("160.79.104.10", 61);
    const rows = await listAccess(db, { since: t0.toISOString(), kind: "claude" });
    expect(rows.filter((r) => r.who === "app_1").map((r) => r.ip)).toEqual(["160.79.104.10", "203.0.113.50", "160.79.104.10"]);
    expect(rows.filter((r) => r.who === "app_2")).toHaveLength(1);
  });
});

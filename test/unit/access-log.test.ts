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
    await recordAccess(db, { kind: "device", ip: "198.51.100.7", ok: true, who: "tok_a" }, { now: at(6), windowMinutes: 60 });
    await recordAccess(db, { kind: "device", ip: "203.0.113.5", ok: true, who: "tok_a" }, { now: at(61), windowMinutes: 60 });
    await recordAccess(db, { kind: "admin", ip: "203.0.113.9", ok: false, detail: "sign-in failed: x" }, { now: at(7) });
    await recordAccess(db, { kind: "admin", ip: "203.0.113.9", ok: false, detail: "sign-in failed: x" }, { now: at(8) });
    const all = await listAccess(db, { since: t0.toISOString() });
    expect(all.filter((r) => r.kind === "device")).toHaveLength(3);
    expect(all.filter((r) => r.kind === "admin")).toHaveLength(2); // failures without a window are all kept
    expect((await listAccess(db, { since: t0.toISOString(), failedOnly: true })).every((r) => !r.ok && r.ip === "203.0.113.9")).toBe(true);
    expect(await listAccess(db, { since: t0.toISOString(), kind: "claude" })).toHaveLength(0);
  });
});

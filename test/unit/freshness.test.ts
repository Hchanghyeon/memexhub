import { describe, expect, it } from "vitest";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { staleLines, staleSources } from "../../src/core/freshness.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (h: number) => new Date(+NOW - h * 3600_000).toISOString();
const ev = (db: ReturnType<typeof sqliteDb>, type: string, at: string, skipped: string | null = null) =>
  db.run(`INSERT INTO events (id, type, occurred_at, received_at, source, payload, skipped) VALUES (?, ?, ?, ?, 'test', '{}', ?)`, [`${type}-${at}-${skipped}`, type, at, at, skipped]);

describe("stopped sources", () => {
  it("reports a source that sent before and then went quiet, not one that never sent", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    const all = () => true;
    expect(await staleSources(db, NOW, all)).toEqual([]); // nothing set up → nothing to miss
    await ev(db, "health", ago(50));
    await ev(db, "ledger", ago(30)); // a day without a card payment is normal
    await db.run(`INSERT INTO location_points (t, lat, lon) VALUES (?, 0, 0)`, [Math.floor((+NOW - 5 * 3600_000) / 1000)]);
    expect(await staleSources(db, NOW, all)).toEqual([{ source: "health", last: ago(50), hours: 50 }]);
    expect(await staleSources(db, NOW, (m) => m !== "health")).toEqual([]); // module off → not asked
    await ev(db, "health", ago(1), "duplicate"); // skipped records do not count as arriving
    expect((await staleSources(db, NOW, all)).map((s) => s.source)).toEqual(["health"]);
  });

  it("words the warning in both languages", () => {
    const s = [{ source: "health" as const, last: "2026-10-18T13:03:00.000Z", hours: 50 }];
    expect(staleLines(s, "ko", "Asia/Seoul")[0]).toBe("⚠ 건강: 2일째 안 들어옴 (마지막 10-18 22:03). 폰 앱·단축어 자동화를 확인하세요.");
    expect(staleLines(s, "en", "UTC")[0]).toContain("nothing for 2 days");
  });
});

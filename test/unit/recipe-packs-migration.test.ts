import { describe, expect, it } from "vitest";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";

const packs = async (db: ReturnType<typeof sqliteDb>) => (await db.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'recipePacks'`))?.value;

describe("migration 8: bundled recipes become opt-in", () => {
  it("a new install starts with none switched on", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    expect(await packs(db)).toBeUndefined();
  });
  it("an install that already had an admin keeps the four it was using", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    await db.run(`INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a', 'owner', 'x', '2026-10-01')`);
    await db.run(`DELETE FROM schema_migrations WHERE id = 8`);
    await migrate(db);
    expect(JSON.parse((await packs(db))!)).toEqual(["kr.hyundai.sms", "kr.samsung.sms", "kr.kcp.mail", "kr.kicc.mail"]);
  });
});

import { describe, expect, it } from "vitest";
import { Inbox, maskLongDigits } from "../../src/core/inbox.js";
import { migrate } from "../../src/core/migrations.js";
import { sqliteDb } from "../../src/platform/node.js";

describe("inbox", () => {
  it("encrypts content, binds it to the item, wipes it when closed and purges old items", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    let now = new Date("2026-10-01T00:00:00Z");
    const ib = new Inbox(db, "s".repeat(48), () => now);
    const a = await ib.add("ledger", "sms", "no recipe", { text: "샘플카드 승인 secret-text" });
    const b = await ib.add("ledger", "sms", "no recipe", { text: "other" });
    const raw = await db.all<{ blob: string }>(`SELECT blob FROM inbox`);
    expect(JSON.stringify(raw)).not.toContain("secret-text");
    expect((await ib.get<{ text: string }>("ledger", a))!.data!.text).toContain("secret-text");
    // swapping ciphertexts between rows must fail (AAD = id)
    await db.run(`UPDATE inbox SET blob = (SELECT blob FROM inbox WHERE id = ?) WHERE id = ?`, [a, b]);
    await expect(ib.get("ledger", b)).rejects.toThrow();
    expect(await ib.get("other-module", a)).toBeUndefined();
    await ib.close("ledger", a, "resolved");
    expect((await ib.get("ledger", a))!.data).toBeUndefined();
    expect(await ib.count("ledger")).toBe(1);
    now = new Date("2026-11-15T00:00:00Z");
    expect(await ib.purge("ledger", 30)).toBe(2);
  });

  it("masks long digit runs only", () => {
    expect(maskLongDigits("계좌 110-123-456789 · 승인 12,500원 · 10/14 12:30 · 1234")).toBe("계좌 •••-•••-•••••• · 승인 12,500원 · 10/14 12:30 · 1234");
  });
});

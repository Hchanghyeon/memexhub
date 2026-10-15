import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { FsStorage } from "../../src/storage/fs.js";
import { ingestApp } from "../../src/http/ingest.js";

let hub: Hub, app: Hono, token = "", healthToken = "";
const post = (path: string, body: unknown, tok = token) =>
  app.request(`https://hub.example.com${path}`, { method: "POST", headers: { "x-ingest-token": tok, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-li-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, { fs: () => new FsStorage(mkdtempSync(join(tmpdir(), "mx-lv-"))) });
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.settings.set("modules", { ledger: { enabled: true } });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.reload();
  token = (await hub.ingestTokens.create("phone", ["ledger"], "t")).token;
  healthToken = (await hub.ingestTokens.create("watch", ["health"], "t")).token;
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", ingestApp(hub));
});

describe("ledger ingest", () => {
  it("records a card SMS", async () => {
    const r = await post("/ingest/sms", { text: "[Web발신]\n삼성1234승인 홍*동\n1,500원 일시불\n10/15 09:11 샘플편의점\n누적98,765원" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, kind: "payment", duplicate: false });
  });
  it("records a wallet transaction and a transit tap", async () => {
    expect(await (await post("/ingest/transaction", { merchant: "Sample Cafe", amount: "₩4,500", card: "Card" })).json()).toMatchObject({ kind: "payment" });
    expect(await (await post("/ingest/transaction", { name: "Tmoney" })).json()).toMatchObject({ kind: "transit" });
  });
  it("rejects wrong scope, bad tokens, junk and oversized bodies — and logs rejects without values", async () => {
    expect((await post("/ingest/sms", { text: "x" }, healthToken)).status).toBe(401);
    expect((await post("/ingest/sms", { text: "x" }, "mxi_nope")).status).toBe(401);
    expect((await post("/ingest/sms", { text: "택배 도착 secret-value" })).status).toBe(422);
    expect((await post("/ingest/transaction", { merchant: "x", password: "hunter2" })).status).toBe(422);
    expect((await post("/ingest/sms", "{not json")).status).toBe(400);
    expect((await post("/ingest/sms", { text: "x".repeat(5000) })).status).toBe(413);
    const rejects = await hub.bus.query(["ledger.reject"], { includeSkipped: true });
    expect(rejects.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rejects)).not.toContain("hunter2");
    expect(JSON.stringify(rejects)).not.toContain("secret-value");
  });
});

describe("ledger notes (observer)", () => {
  it("redraws the payments and money notes and keeps human edits", async () => {
    await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
    const s = await hub.settings.get();
    await hub.settings.set("vault", { ...s.vault, connection: "vault" });
    await hub.settings.set("ledger", { ...s.ledger, language: "ko", officePlaces: ["Office"] });
    await hub.reload();
    expect((await post("/ingest/sms", { text: "[Web발신]\n현대카드 M 승인\n홍*동\n12,500원 일시불\n10/14 12:30\n샘플카페\n누적 345,000원" })).status).toBe(200);
    const pay = (await hub.vault!.read("ledger/payments/2026.md")).text;
    expect(pay).toContain("| 12:30 | 샘플카페 | ₩12,500 | 현대카드 M 일시불 |");
    const money = (await hub.vault!.read("ledger/money.md")).text;
    expect(money).toContain("<!-- memexhub:auto id=money -->");
    await hub.vault!.write("ledger/money.md", money.replace("## 메모\n", "## 메모\n\n사람이 쓴 줄\n"));
    await post("/ingest/transaction", { merchant: "Sample Bakery", amount: "₩3,000", card: "Card", time: "2026-10-14T13:00:00+09:00" });
    const money2 = (await hub.vault!.read("ledger/money.md")).text;
    expect(money2).toContain("사람이 쓴 줄");
    expect((await hub.vault!.read("ledger/payments/2026.md")).text).toContain("Sample Bakery");
  });
});

describe("payments_day", () => {
  it("returns one day compactly", async () => {
    const tool = hub.tools.find((t) => t.name === "payments_day")!;
    const out = await tool.run({ date: "2026-10-14" }, { actor: "t" });
    expect(out.startsWith("### 10-14 (수)")).toBe(true);
    expect(out).toContain("샘플카페");
    expect(await tool.run({ date: "2020-01-01" }, { actor: "t" })).toBe("no ledger records on 2020-01-01");
  });
});

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

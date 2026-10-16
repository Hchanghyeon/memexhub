import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { testFs } from "../helpers.js";
import { ingestApp } from "../../src/http/ingest.js";
import { adminClient } from "../admin-client.js";

let hub: Hub, ingest: Hono, token = "", a: ReturnType<typeof adminClient>;
const BASE = "http://10.0.0.2";

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-ar-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-av-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("modules", { ledger: { enabled: true } });
  await hub.reload();
  ingest = new Hono().use("*", (c: any, n: any) => (c.set("ip", "10.0.0.9"), n())).route("/", ingestApp(hub));
  token = (await hub.ingestTokens.create("phone", ["ledger"], "t")).token;
  a = adminClient(hub);
  await a.login();
});

describe("admin API: recipes & inbox", () => {
  const SAMPLE = "[Web발신]\n샘플카드 승인\n김*수\n5,500원 일시불\n10/14 08:10\n샘플베이커리";

  it("needs a session and the CSRF header", async () => {
    const anon = adminClient(hub);
    expect((await anon.get("/recipes")).status).toBe(401);
    expect((await a.post("/recipes/save", { json: "{}" }, { "x-csrf": "wrong" })).status).toBe(403);
  });

  it("tries a message and lists built-in recipes", async () => {
    const r = await (await a.post("/recipes/try", { channel: "sms", text: "[Web발신]\n현대카드 M 승인\n김*수\n1,000원 일시불\n10/14 12:30\n샘플카페" })).json();
    expect(r).toMatchObject({ step: "recipe", recipeId: "kr.hyundai.sms", confident: true, payment: { merchant: "샘플카페" } });
    expect((await a.json("/recipes")).active.map((x: { id: string }) => x.id)).toContain("kr.samsung.sms");
  });

  it("drafts, saves, approves and disables a recipe", async () => {
    const draft = (await (await a.post("/recipes/draft", { channel: "sms", text: SAMPLE })).json()).json as string;
    expect(draft).toContain('"card": "샘플카드"');
    expect((await (await a.post("/recipes/save", { json: "{nope" })).json()).detail).toMatch(/Not valid JSON/);
    const recipe = { id: "custom.sample.sms", name: "샘플카드", channels: ["sms"], match: { any: ["샘플카드"] }, set: { card: "샘플카드 Plus" }, examples: [{ text: SAMPLE, expect: { amount: "₩5,500", card: "샘플카드 Plus 일시불" } }] };
    expect((await (await a.post("/recipes/save", { json: JSON.stringify(recipe) })).json()).message).toContain("proposed/custom.sample.sms.md");
    expect((await (await a.post("/recipes/approve", { file: "memexhub/recipes/../CLAUDE.md" })).json()).detail).toMatch(/not a proposal/);
    expect((await (await a.post("/recipes/approve", { file: "memexhub/recipes/proposed/custom.sample.sms.md" })).json()).message).toMatch(/now active/);
    expect((await (await a.post("/recipes/try", { channel: "sms", text: SAMPLE })).json()).recipeId).toBe("custom.sample.sms");
    expect((await (await a.post("/recipes/disable", { id: "kr.samsung.sms" })).json()).message).toMatch(/Disabled built-in/);
    expect((await a.json("/recipes")).active.map((x: { id: string }) => x.id)).not.toContain("kr.samsung.sms");
    const pack = await (await a.get("/recipes/export")).json();
    expect((pack as { id: string }[]).map((r) => r.id)).toContain("custom.sample.sms");
    expect((await (await a.post("/recipes/import", { json: JSON.stringify([{ id: "kr.bad", match: { any: ["(a+)+"] } }, { ...recipe, id: "custom.copy.sms" }]) })).json()).message).toMatch(/Imported 1 as proposals; skipped 1/);
  });

  it("records and ignores inbox items", async () => {
    const send = async (text: string) =>
      ((await (await ingest.request(`${BASE}/ingest/message`, { method: "POST", headers: { "x-ingest-token": token, "content-type": "application/json" }, body: JSON.stringify({ channel: "sms", text }) })).json()) as { inbox: string }).inbox;
    const x = await send("샘플페이 결제 3,300원");
    const y = await send("샘플페이 결제 4,400원");
    expect((await a.json("/recipes")).inbox).toHaveLength(2);
    expect((await (await a.post(`/inbox/${x}`, { action: "record", amount: "3300" })).json()).detail).toMatch(/Amount must look like/);
    expect((await (await a.post(`/inbox/${x}`, { action: "record", merchant: "샘플페이", amount: "₩3,300", time: "2026-10-14T10:00:00+09:00" })).json()).message).toMatch(/Recorded as payment/);
    expect((await (await a.post(`/inbox/${y}`, { action: "ignore" })).json()).message).toBe("Ignored.");
    expect((await a.json("/recipes")).inbox).toHaveLength(0);
  });
});

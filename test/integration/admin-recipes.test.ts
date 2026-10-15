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
import { adminApp } from "../../src/admin/app.js";
import { ingestApp } from "../../src/http/ingest.js";

let hub: Hub, admin: Hono, ingest: Hono, cookie = "", csrf = "", token = "";
const BASE = "http://10.0.0.2";
const get = (p: string) => admin.request(`${BASE}${p}`, { headers: { cookie } });
const postForm = (p: string, f: Record<string, string>) =>
  admin.request(`${BASE}${p}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf, ...f }).toString() });
const flash = (r: Response) => Object.fromEntries(new URL(r.headers.get("location")!, BASE).searchParams);

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
  const withIp = (c: any, n: any) => (c.set("ip", "10.0.0.9"), n());
  admin = new Hono().use("*", withIp).route("/", adminApp(hub, { vaultRoots: [], builtinVault: "" }));
  ingest = new Hono().use("*", withIp).route("/", ingestApp(hub));
  token = (await hub.ingestTokens.create("phone", ["ledger"], "t")).token;
  const login = await admin.request(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=owner&password=a-long-test-password" });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  csrf = (await (await get("/ledger/recipes")).text()).match(/name="csrf" value="([^"]+)"/)![1]!;
});

describe("admin: recipes & inbox", () => {
  const SAMPLE = "[Web발신]\n샘플카드 승인\n김*수\n5,500원 일시불\n10/14 08:10\n샘플베이커리";

  it("needs a session and a CSRF token", async () => {
    expect((await admin.request(`${BASE}/ledger/recipes`)).status).toBe(302);
    const r = await admin.request(`${BASE}/ledger/recipes/save`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "json=%7B%7D&csrf=wrong" });
    expect(r.status).toBe(403);
  });

  it("tries a message and lists built-in recipes", async () => {
    const page = await (await postForm("/ledger/try", { text: "[Web발신]\n현대카드 M 승인\n김*수\n1,000원 일시불\n10/14 12:30\n샘플카페", channel: "sms" })).text();
    expect(page).toContain("Would be recorded — recipe kr.hyundai.sms.");
    expect(page).toContain("샘플카페");
    expect(page).toContain("kr.samsung.sms");
  });

  it("drafts, saves, approves and disables a recipe", async () => {
    const draft = await (await postForm("/ledger/draft", { text: SAMPLE, channel: "sms" })).text();
    expect(draft).toContain("&quot;card&quot;: &quot;샘플카드&quot;");
    expect(flash(await postForm("/ledger/recipes/save", { json: "{nope" })).err).toMatch(/Not valid JSON/);
    const recipe = { id: "custom.sample.sms", name: "샘플카드", channels: ["sms"], match: { any: ["샘플카드"] }, set: { card: "샘플카드 Plus" }, examples: [{ text: SAMPLE, expect: { amount: "₩5,500", card: "샘플카드 Plus 일시불" } }] };
    expect(flash(await postForm("/ledger/recipes/save", { json: JSON.stringify(recipe) })).ok).toContain("proposed/custom.sample.sms.md");
    expect(flash(await postForm("/ledger/recipes/approve", { file: "memexhub/recipes/../CLAUDE.md" })).err).toMatch(/not a proposal/);
    expect(flash(await postForm("/ledger/recipes/approve", { file: "memexhub/recipes/proposed/custom.sample.sms.md" })).ok).toMatch(/now active/);
    const tried = await (await postForm("/ledger/try", { text: SAMPLE, channel: "sms" })).text();
    expect(tried).toContain("recipe custom.sample.sms");
    expect(flash(await postForm("/ledger/recipes/disable", { id: "kr.samsung.sms" })).ok).toMatch(/Disabled built-in/);
    const page = await (await get("/ledger/recipes")).text();
    expect(page).not.toMatch(/<td>삼성카드 문자/);
    const pack = await (await get("/ledger/recipes/export")).json();
    expect((pack as { id: string }[]).map((r) => r.id)).toContain("custom.sample.sms");
    expect(flash(await postForm("/ledger/recipes/import", { json: JSON.stringify([{ id: "kr.bad", match: { any: ["(a+)+"] } }, { ...recipe, id: "custom.copy.sms" }]) })).ok).toMatch(/Imported 1 as proposals; skipped 1/);
  });

  it("records and ignores inbox items", async () => {
    const send = async (text: string) =>
      ((await (await ingest.request(`${BASE}/ingest/message`, { method: "POST", headers: { "x-ingest-token": token, "content-type": "application/json" }, body: JSON.stringify({ channel: "sms", text }) })).json()) as { inbox: string }).inbox;
    const a = await send("샘플페이 결제 3,300원");
    const b = await send("샘플페이 결제 4,400원");
    expect(await (await get("/ledger/recipes")).text()).toContain("Inbox (2)");
    expect(flash(await postForm(`/ledger/inbox/${a}`, { action: "record", amount: "3300" })).err).toMatch(/Amount must look like/);
    expect(flash(await postForm(`/ledger/inbox/${a}`, { action: "record", merchant: "샘플페이", amount: "₩3,300", time: "2026-10-14T10:00:00+09:00" })).ok).toMatch(/Recorded as payment/);
    expect(flash(await postForm(`/ledger/inbox/${b}`, { action: "ignore" })).ok).toBe("Ignored.");
    expect(await (await get("/ledger/recipes")).text()).toContain("Inbox (0)");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminApp } from "../../src/admin/app.js";
import { testFs } from "../helpers.js";

let hub: Hub, app: Hono, cookie = "", csrf = "";
const BASE = "http://10.0.0.2";
const upload = (path: string, name: string, body: string) => {
  const fd = new FormData();
  fd.set("csrf", csrf);
  fd.set("file", new File([body], name));
  return app.request(`${BASE}${path}`, { method: "POST", headers: { cookie }, body: fd });
};
const msg = (r: Response) => Object.fromEntries(new URL(r.headers.get("location")!, BASE).searchParams);

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-im-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T14:30:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-imv-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("ledger", { ...s.ledger, language: "ko", officePlaces: ["회사"] });
  await hub.settings.set("health", { ...s.health, language: "ko" });
  await hub.settings.set("modules", { ledger: { enabled: true }, health: { enabled: true } });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "10.0.0.9"), n())).route("/", adminApp(hub, { vaultRoots: [], builtinVault: "" }));
  const login = await app.request(`${BASE}/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=owner&password=a-long-test-password" });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  csrf = (await (await app.request(`${BASE}/import`, { headers: { cookie } })).text()).match(/name="csrf" value="([^"]+)"/)![1]!;
});

describe("import from a previous setup", () => {
  it("payments: the redrawn note matches the reference output; importing twice adds nothing", async () => {
    const jsonl = readFileSync("test/fixtures/ledger/transactions.jsonl", "utf8");
    const rows = jsonl.trim().split("\n").length;
    const r = msg(await upload("/import/ledger", "t.jsonl", `${jsonl.trimEnd()}\nnot json\n{"merchant":"no time"}\n`));
    expect(r.ok).toMatch(new RegExp(`^Added ${rows} payments, skipped 0 already present\\. Unreadable lines: ${rows + 1}, ${rows + 2}\\.$`));
    const note = (await hub.vault!.read("ledger/payments/2026.md")).text;
    expect(note).toContain(readFileSync("test/golden/payments-2026.ko.md", "utf8"));
    expect(msg(await upload("/import/ledger", "t.jsonl", jsonl)).ok).toBe(`Added 0 payments, skipped ${rows} already present.`);
  });

  it("health days", async () => {
    const days = { "2026-10-13": { metrics: { steps: 8240, resting_hr: 58 }, workouts: [{ type: "달리기", min: 32, kcal: 310 }] }, "2026-10-14": { sleep: { start: "23:40", end: "06:50", asleep_min: 410 } } };
    expect(msg(await upload("/import/health", "h.json", JSON.stringify(days))).ok).toBe("Imported 2 days.");
    const note = (await hub.vault!.read("health/2026.md")).text;
    expect(note).toContain("- 10-13 (화) 걸음 8,240 · 안정 심박 58 · 🏃 달리기 32분 310 kcal");
    expect(note).toContain("- 10-14 (수) 😴 23:40–06:50 · 6시간 50분");
    expect(msg(await upload("/import/health", "h.json", '{"bad-date": {}}')).err).toMatch(/not health days/);
  });

  it("keeps an existing device token (hashed) and counts WebDAV tokens right", async () => {
    const form = (f: Record<string, string>) => app.request(`${BASE}/import/token`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf, ...f }).toString() });
    const legacy = "legacy-token-0123456789abcdefghij";
    expect(msg(await form({ name: "phone", token: "short", scopes: "ledger" })).err).toMatch(/at least 24/);
    expect(msg(await form({ name: "phone", token: legacy, scopes: "ledger,dav" })).ok).toMatch(/Token kept/);
    expect(await hub.ingestTokens.verify(legacy, "ledger")).not.toBeNull();
    expect(msg(await form({ name: "again", token: legacy, scopes: "ledger" })).err).toMatch(/already known/);
    expect(JSON.stringify(await hub.platform.db.all(`SELECT * FROM ingest_tokens`))).not.toContain(legacy);
    await hub.settings.set("dav", { enabled: true, maxFileMb: 50 });
    expect(await (await app.request(`${BASE}/security`, { headers: { cookie } })).text()).toContain("Vault sync (WebDAV) is on for 1 device(s).");
  });
});

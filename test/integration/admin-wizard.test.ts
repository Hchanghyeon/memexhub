import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminApp, securityChecks } from "../../src/admin/app.js";
import { SettingsSchema } from "../../src/core/settings.js";
import { testFs } from "../helpers.js";

let hub: Hub, app: Hono, cookie = "", csrf = "";
const BASE = "http://10.0.0.2";
const form = (p: string, f: Record<string, string>) =>
  app.request(`${BASE}${p}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf, ...f }).toString() });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-wz-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-wzv-")))]);
  const log = console.log;
  let code = "";
  console.log = (...a: unknown[]) => {
    const m = String(a.join(" ")).match(/setup code[^A-Za-z0-9]*([A-Za-z0-9-]{6,})/i);
    if (m) code = m[1]!;
  };
  await hub.init();
  console.log = log;
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "10.0.0.9"), n())).route("/", adminApp(hub, { vaultRoots: [], builtinVault: "" }));
  const r = await app.request(`${BASE}/setup`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, username: "owner", password: "a-long-test-password" }).toString() });
  expect(r.headers.get("location")).toBe("/start");
  cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  csrf = (await (await app.request(`${BASE}/start`, { headers: { cookie } })).text()).match(/name="csrf" value="([^"]+)"/)![1]!;
});

describe("first-run wizard", () => {
  it("walks through the four steps, each skippable", async () => {
    const one = await (await app.request(`${BASE}/start`, { headers: { cookie } })).text();
    expect(one).toContain("Step 1 of 4");
    expect(one).toContain('<option value="Asia/Seoul"');
    expect(one).toContain('href="/start?step=2"');
    expect((await form("/start/basics", { timezone: "Asia/Seoul", notes: "ko", tools: "both" })).headers.get("location")).toBe("/start?step=2");
    const s = await hub.settings.get();
    expect([s.timezone, s.toolLanguage, s.ledger.language, s.health.language, s.location.language]).toEqual(["Asia/Seoul", "both", "ko", "ko", "ko"]);
    expect((await form("/start/basics", { timezone: "Mars/Olympus" })).status).toBe(302);
    expect((await hub.settings.get()).timezone).toBe("Asia/Seoul");
    expect((await form("/vault", { provider: "builtin", next: "3" })).headers.get("location")).toBe("/start?step=3");
    expect(hub.vault).toBeDefined();
    expect((await form("/wiki/preset", { preset: "para-ko", next: "https://evil.example.com" })).headers.get("location")).toBe("/#wiki");
    expect((await form("/wiki/preset", { preset: "llm-wiki", next: "4" })).headers.get("location")).toBe("/start?step=4");
    expect(await (await app.request(`${BASE}/start?step=4`, { headers: { cookie } })).text()).toContain("https://hub.example.com/mcp");
    expect(await (await app.request(`${BASE}/`, { headers: { cookie } })).text()).toContain("Continue setup");
    expect((await form("/start/done", {})).headers.get("location")).toBe("/");
    expect(await (await app.request(`${BASE}/`, { headers: { cookie } })).text()).not.toContain("Continue setup");
  });
});

describe("security checks", () => {
  const base = SettingsSchema.parse({});
  it("flags an open admin without two-factor as high and lists the rest plainly", () => {
    const bad = securityChecks({ totp: false, s: { ...base, admin: { allowPublic: true } }, vault: false, davTokens: 0, publicUrl: "http://localhost:8787" });
    expect(bad.filter((x) => x.level === "high").map((x) => x.text)).toEqual([
      "The admin UI is open to the internet without two-factor — turn two-factor on now.",
      "PUBLIC_URL uses http — use https outside local testing.",
    ]);
    const good = securityChecks({ totp: true, s: { ...base, mcp: { allowCidrs: ["160.79.104.0/21"], enforceAllow: true } }, vault: true, davTokens: 0, publicUrl: "https://hub.example.com" });
    expect(good.every((x) => x.ok)).toBe(true);
    const dav = securityChecks({ totp: true, s: { ...base, dav: { enabled: true, maxFileMb: 50 } }, vault: true, davTokens: 0, publicUrl: "https://x" });
    expect(dav.find((x) => x.text.includes("WebDAV"))?.ok).toBe(false);
  });
});

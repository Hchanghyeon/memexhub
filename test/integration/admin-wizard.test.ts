import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { securityChecks, vaultChoice } from "../../src/admin/app.js";
import { SettingsSchema } from "../../src/core/settings.js";
import { testFs } from "../helpers.js";
import { adminClient } from "../admin-client.js";

let hub: Hub, a: ReturnType<typeof adminClient>, code = "";

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-wz-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-wzv-")))]);
  const log = console.log;
  console.log = (...x: unknown[]) => {
    const m = String(x.join(" ")).match(/setup code[^A-Za-z0-9]*([A-Za-z0-9-]{6,})/i);
    if (m) code = m[1]!;
  };
  await hub.init();
  console.log = log;
  a = adminClient(hub);
});

describe("first run", () => {
  it("creates the admin with the setup code, once", async () => {
    expect((await a.post("/setup", { code: "wrong-code-000", username: "owner", password: "a-long-test-password" })).status).toBe(403);
    expect((await a.post("/setup", { code, username: "owner", password: "short" })).status).toBe(400);
    await a.adopt(await a.post("/setup", { code, username: "owner", password: "a-long-test-password" }));
    expect(await a.json("/session")).toMatchObject({ signedIn: true, username: "owner", onboarded: false });
    expect((await a.post("/setup", { code, username: "again", password: "a-long-test-password" })).status).toBe(409);
  });

  it("walks through the setup steps", async () => {
    const start = await a.json("/start");
    expect(start.zones).toContain("Asia/Seoul");
    expect(start.mcpUrl).toBe("https://hub.example.com/mcp");
    expect((await a.post("/start/basics", { timezone: "Asia/Seoul", notes: "ko", tools: "both" })).status).toBe(200);
    const s = await hub.settings.get();
    expect([s.timezone, s.toolLanguage, s.ledger.language, s.health.language, s.location.language]).toEqual(["Asia/Seoul", "both", "ko", "ko", "ko"]);
    await a.post("/start/basics", { timezone: "Mars/Olympus", notes: "ko", tools: "ko" });
    expect((await hub.settings.get()).timezone).toBe("Asia/Seoul");
    expect((await a.post("/vault", { provider: "builtin" })).status).toBe(200);
    expect(hub.vault).toBeDefined();
    expect((await a.post("/wiki/preset", { preset: "nope" })).status).toBe(400);
    expect((await a.post("/wiki/preset", { preset: "llm-wiki" })).status).toBe(200);
    expect((await a.json("/overview")).onboarded).toBe(false);
    await a.post("/start/done");
    expect((await a.json("/overview")).onboarded).toBe(true);
  });
});

describe("vault form", () => {
  it("shows the current vault, so saving it unchanged keeps it", async () => {
    expect(vaultChoice({ provider: "fs", config: { path: "/vaults/notes" } })).toEqual({ provider: "folder", path: "/vaults/notes" });
    expect(vaultChoice({ provider: "fs", config: {} })).toEqual({ provider: "builtin" });
    expect(vaultChoice({ provider: "webdav", config: { url: "https://dav.example.com/v", username: "me" } })).toMatchObject({ provider: "webdav", url: "https://dav.example.com/v", username: "me" });
    expect(vaultChoice(undefined)).toEqual({});
    await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: { path: "/vaults/notes" } }, "t");
    expect((await a.json("/vault")).choice).toEqual({ provider: "folder", path: "/vaults/notes" });
  });
});

describe("devices and connections", () => {
  it("creates a token with chosen scopes and refuses unknown ones", async () => {
    const r = await (await a.post("/devices", { name: "phone", scopes: ["ledger", "location"] })).json();
    expect(r.token).toMatch(/.{24,}/);
    expect((await a.json("/devices")).tokens[0]).toMatchObject({ name: "phone", scopes: ["ledger", "location"] });
    expect((await a.post("/devices", { name: "x", scopes: ["admin"] })).status).toBe(400);
    expect((await a.post("/devices", { name: "x", scopes: [] })).status).toBe(400);
  });
});

describe("security checks", () => {
  const base = SettingsSchema.parse({});
  it("flags an open admin without two-factor as high and lists the rest", () => {
    const bad = securityChecks({ totp: false, s: { ...base, admin: { allowPublic: true, language: "auto" } }, vault: false, davTokens: 0, publicUrl: "http://localhost:8787" });
    expect(bad.filter((x) => x.level === "high").map((x) => x.id)).toEqual(["totp_off_public", "http_url"]);
    const good = securityChecks({ totp: true, s: { ...base, mcp: { allowCidrs: ["160.79.104.0/21"], enforceAllow: true } }, vault: true, davTokens: 0, publicUrl: "https://hub.example.com" });
    expect(good.every((x) => x.ok)).toBe(true);
    const dav = securityChecks({ totp: true, s: { ...base, dav: { enabled: true, maxFileMb: 50 } }, vault: true, davTokens: 0, publicUrl: "https://x" });
    expect(dav.find((x) => x.id === "dav_no_devices")?.ok).toBe(false);
  });
});

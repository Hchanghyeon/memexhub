import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { totp } from "../../src/core/crypto.js";
import { adminClient } from "../admin-client.js";

let hub: Hub, secret = "", adminId = "";
const PW = "a-long-test-password";
const OUTSIDE = { ip: "203.0.113.9", origin: "https://admin.example.com" };

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-2fa-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, []);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  adminId = await hub.admin.createAdmin("owner", PW, "t");
  secret = await hub.admin.startTotp(adminId);
  await hub.admin.confirmTotp(adminId, await totp(secret, Date.now()));
  await hub.settings.set("admin", { allowPublic: true, language: "auto" });
});

const cookies = (r: Response) => Object.fromEntries(r.headers.getSetCookie().map((c) => c.split(";")[0]!.split("=") as [string, string]));
const login = (ip: { ip?: string; origin?: string }, body: Record<string, unknown>, cookie = "") =>
  adminClient(hub, ip).req("/login", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ username: "owner", password: PW, ...body }) });

describe("two-factor where it matters", () => {
  it("asks no code on the home network, and always one from the internet", async () => {
    expect((await login({}, {})).status).toBe(200);
    expect((await adminClient(hub).json("/session")).home).toBe(true);
    expect((await adminClient(hub, OUTSIDE).json("/session")).home).toBe(false);
    expect((await login(OUTSIDE, {})).status).toBe(401);
    expect((await login(OUTSIDE, { totp: "000000" })).status).toBe(401);
    const ok = await login(OUTSIDE, { totp: await totp(secret, Date.now()) });
    expect(ok.status).toBe(200);
    expect(cookies(ok).mx_trust).toBeUndefined(); // not remembered unless asked
  });

  it("remembers a browser for 30 days only after it passed the code, and only for that admin", async () => {
    const home = await login({}, { remember: true });
    expect(cookies(home).mx_trust).toBeUndefined(); // no code was used at home → nothing to remember
    const r = await login(OUTSIDE, { totp: await totp(secret, Date.now()), remember: true });
    const trust = cookies(r).mx_trust!;
    expect(trust).toMatch(/^trd_/);
    expect(r.headers.getSetCookie().find((c) => c.startsWith("mx_trust="))).toMatch(/HttpOnly.*Max-Age=2592000|Max-Age=2592000.*HttpOnly/);
    expect((await login(OUTSIDE, {}, `mx_trust=${trust}`)).status).toBe(200);
    expect((await login(OUTSIDE, {}, "mx_trust=trd_forged_value_forged_value")).status).toBe(401);
    expect((await login(OUTSIDE, { password: "wrong-password-xx" }, `mx_trust=${trust}`)).status).toBe(401); // the password is still needed
    const other = await hub.admin.createAdmin("other", "another-long-password", "t");
    const s2 = await hub.admin.startTotp(other);
    await hub.admin.confirmTotp(other, await totp(s2, Date.now()));
    expect((await login(OUTSIDE, { username: "other", password: "another-long-password" }, `mx_trust=${trust}`)).status).toBe(401);
    expect(await hub.admin.trustedCount(adminId)).toBe(2); // the home and the outside browser both stay signed in
  });

  it("stays signed in for 30 days when asked, otherwise ends after 30 idle minutes", async () => {
    const sid = (r: Response) => cookies(r).mx_admin!;
    const stay = await login({}, { remember: true });
    const short = await login({}, {});
    expect(stay.headers.getSetCookie().find((c) => c.startsWith("mx_admin="))).toMatch(/Max-Age=2592000/);
    expect(short.headers.getSetCookie().find((c) => c.startsWith("mx_admin="))).not.toMatch(/Max-Age/);
    const db = hub.platform.db;
    const hour = new Date(Date.now() - 3600_000).toISOString();
    await db.run(`UPDATE admin_sessions SET last_seen_at = ?`, [hour]); // an hour without use
    expect(await hub.admin.session(sid(stay))).not.toBeNull();
    expect(await hub.admin.session(sid(short))).toBeNull();
    await db.run(`UPDATE admin_sessions SET expires_at = ? WHERE expires_at IS NOT NULL`, [new Date(Date.now() - 1000).toISOString()]);
    expect(await hub.admin.session(sid(stay))).toBeNull(); // 30 days are over
  });

  it("changing the password needs the current one, signs out other sessions and forgets browsers", async () => {
    const r = await login(OUTSIDE, { totp: await totp(secret, Date.now()), remember: true });
    const trust = cookies(r).mx_trust!;
    const other = adminClient(hub);
    await other.login();
    const me = adminClient(hub);
    await me.login();
    expect((await (await me.post("/password", { current: "wrong-password-xx", next: "a-brand-new-password" })).json()).error).toBe("wrong_password");
    expect((await (await me.post("/password", { current: PW, next: "short" })).json()).error).toBe("invalid_input");
    expect((await me.post("/password", { current: PW, next: "a-brand-new-password" })).status).toBe(200);
    expect((await me.get("/overview")).status).toBe(200); // this session stays
    expect((await other.get("/overview")).status).toBe(401); // others are signed out
    expect(await hub.admin.trustedCount(adminId)).toBe(0);
    expect((await login(OUTSIDE, { password: "a-brand-new-password" }, `mx_trust=${trust}`)).status).toBe(401);
    expect((await login({}, {})).status).toBe(401); // old password
    expect((await login({}, { password: "a-brand-new-password" })).status).toBe(200);
  });

  it("can forget all remembered browsers", async () => {
    const r = await login(OUTSIDE, { password: "a-brand-new-password", totp: await totp(secret, Date.now()), remember: true });
    expect(await hub.admin.trustedCount(adminId)).toBe(1);
    const me = adminClient(hub);
    await me.login("owner", "a-brand-new-password");
    expect((await me.json("/security")).trustedDevices).toBe(1);
    await me.post("/forget-devices");
    expect(await hub.admin.trustedCount(adminId)).toBe(0);
    expect(await hub.admin.session(cookies(r).mx_admin)).toBeNull(); // the other browser is signed out
    expect((await me.get("/overview")).status).toBe(200); // this one stays
    expect((await login(OUTSIDE, { password: "a-brand-new-password" }, `mx_trust=${cookies(r).mx_trust}`)).status).toBe(401);
  });
});

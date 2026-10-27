import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { totp } from "../../src/core/crypto.js";
import { adminClient } from "../admin-client.js";

// Moving two-factor to a new phone, and turning it off: from the app's account screen.
let hub: Hub, secret = "", adminId = "";
const PW = "a-long-test-password";
const OUTSIDE = { ip: "203.0.113.9", origin: "https://admin.example.com" };

beforeEach(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-2fm-")) });
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

const outside = async () => {
  const me = adminClient(hub, OUTSIDE);
  await me.login("owner", PW, await totp(secret, Date.now()));
  return me;
};
const home = async () => {
  const me = adminClient(hub);
  await me.login("owner", PW);
  return me;
};

describe("moving two-factor to a new authenticator app", () => {
  it("from outside it needs the current code; the old key stops working once the new one is confirmed", async () => {
    const me = await outside();
    expect((await (await me.post("/totp/start", {})).json()).error).toBe("code_needed");
    expect((await (await me.post("/totp/start", { code: "000000" })).json()).error).toBe("code_needed");
    const r = (await (await me.post("/totp/start", { code: await totp(secret, Date.now()) })).json()) as { secret: string };
    expect(r.secret).toMatch(/^[A-Z2-7]{32}$/);
    // Until confirmed, the old key still signs in.
    expect(await hub.admin.checkTotp(adminId, await totp(secret, Date.now()))).toBe(true);
    expect((await me.post("/totp/confirm", { code: await totp(r.secret, Date.now()) })).status).toBe(200);
    expect(await hub.admin.checkTotp(adminId, await totp(secret, Date.now()))).toBe(false);
    expect(await hub.admin.checkTotp(adminId, await totp(r.secret, Date.now()))).toBe(true);
  });

  it("at home it needs no code (the old phone may be gone)", async () => {
    const me = await home();
    const r = (await (await me.post("/totp/start")).json()) as { secret: string };
    expect(r.secret).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe("turning two-factor off", () => {
  it("is refused from outside, even with the password", async () => {
    const me = await outside();
    expect((await (await me.post("/totp/disable", { password: PW })).json()).error).toBe("home_only");
    expect(await hub.admin.hasTotp(adminId)).toBe(true);
  });

  it("needs the password at home", async () => {
    const me = await home();
    expect((await (await me.post("/totp/disable", { password: "wrong-password-123" })).json()).error).toBe("wrong_password");
    expect(await hub.admin.hasTotp(adminId)).toBe(true);
  });

  it("at home with the password: off, remembered browsers forgotten, the admin app closed to the internet", async () => {
    // A browser outside was remembered.
    const r = await adminClient(hub, OUTSIDE).req("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: PW, totp: await totp(secret, Date.now()), remember: true }) });
    expect(r.status).toBe(200);
    expect(await hub.admin.trustedCount(adminId)).toBeGreaterThan(0);
    const me = await home();
    expect((await me.post("/totp/disable", { password: PW })).status).toBe(200);
    expect(await hub.admin.hasTotp(adminId)).toBe(false);
    expect((await hub.settings.get()).admin.allowPublic).toBe(false);
    expect((await hub.platform.db.get<{ n: number }>(`SELECT COUNT(*) n FROM admin_trusted`))?.n).toBe(0);
    // From the internet the admin app is closed again.
    const out = adminClient(hub, OUTSIDE);
    expect((await out.req("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: PW }) })).status).not.toBe(200);
  });

  it("does nothing for a signed-out caller", async () => {
    expect((await adminClient(hub).post("/totp/disable", { password: PW })).status).toBe(401);
    expect(await hub.admin.hasTotp(adminId)).toBe(true);
  });
});

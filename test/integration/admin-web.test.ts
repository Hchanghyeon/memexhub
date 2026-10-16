import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { nodeAdminAssets } from "../../src/platform/node-assets.js";
import { adminClient } from "../admin-client.js";

let hub: Hub, dir = "";
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-web-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, []);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  dir = mkdtempSync(join(tmpdir(), "mx-dist-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(join(dir, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(dir, "..", "secret.txt"), "nope");
});

describe("admin web app under /admin", () => {
  it("serves index.html for app paths with a CSP that allows only its own scripts", async () => {
    const a = adminClient(hub, { assets: nodeAdminAssets(dir) });
    for (const p of ["/admin/", "/admin/vault", "/admin/recipes", "/admin/notes/Projects/Garden%20plan.md", "/admin/notes/a..b.md"]) {
      const r = await a.app.request(`http://10.0.0.2${p}`);
      expect(r.status, p).toBe(200);
      expect(await r.text()).toContain("<div id=root>");
      const csp = r.headers.get("content-security-policy")!;
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-eval");
    }
  });
  it("serves hashed files with long caching, and nothing outside the folder", async () => {
    const a = adminClient(hub, { assets: nodeAdminAssets(dir) });
    const js = await a.app.request("http://10.0.0.2/admin/assets/index-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(js.headers.get("cache-control")).toMatch(/immutable/);
    expect((await a.app.request("http://10.0.0.2/admin/assets/missing.js")).status).toBe(404);
    expect((await a.app.request("http://10.0.0.2/admin/..%2Fsecret.txt")).status).toBe(404);
    expect((await a.app.request("http://10.0.0.2/admin/assets/..%2F..%2Fsecret.txt")).status).toBe(404);
    expect(await nodeAdminAssets(dir).file("../secret.txt")).toBeNull();
  });
  it("says when the web app is not built", async () => {
    const a = adminClient(hub, { assets: nodeAdminAssets(join(dir, "nothing")) });
    expect((await a.app.request("http://10.0.0.2/admin/")).status).toBe(503);
  });
  it("is home-network only unless opened", async () => {
    const outside = adminClient(hub, { ip: "203.0.113.9", assets: nodeAdminAssets(dir) });
    expect((await outside.app.request("http://10.0.0.2/admin/")).status).toBe(403);
    expect((await outside.get("/session")).status).toBe(403);
  });
  it("the API reports the session state", async () => {
    const a = adminClient(hub);
    expect(await a.json("/session")).toMatchObject({ setupNeeded: true, signedIn: false });
  });
});

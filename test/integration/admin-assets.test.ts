import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminApp } from "../../src/admin/app.js";
import { nodeAdminAssets } from "../../src/platform/node-assets.js";
import { setFontHref } from "../../src/admin/layout.js";

describe("admin web font", () => {
  it("serves the vendored font publicly and cacheably, nothing else", async () => {
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-as-")) });
    const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, []);
    const log = console.log;
    console.log = () => {};
    await hub.init();
    console.log = log;
    const assets = await nodeAdminAssets();
    expect(assets).toBeDefined();
    const app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "10.0.0.9"), n())).route("/admin", adminApp(hub, { vaultRoots: [], builtinVault: "", base: "/admin", assets }));
    const css = await app.request("http://10.0.0.2/admin/assets/pretendard.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("cache-control")).toMatch(/max-age/);
    const text = await css.text();
    expect(text).toContain("url(/admin/assets/font/PretendardVariable.subset.0.woff2)");
    const font = await app.request("http://10.0.0.2/admin/assets/font/PretendardVariable.subset.0.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect((await app.request("http://10.0.0.2/admin/assets/font/..%2F..%2Fpackage.json")).status).toBe(404);
    expect((await app.request("http://10.0.0.2/admin/assets/font/pretendard.css")).status).toBe(404);
    const login = await app.request("http://10.0.0.2/admin/setup");
    expect(await login.text()).toContain('<link rel="stylesheet" href="/admin/assets/pretendard.css"/>');
    expect(login.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(await (await app.request("http://10.0.0.2/admin/setup")).text()).toContain('"Pretendard Variable"'); // quotes in the CSS are not escaped
    setFontHref(undefined);
  });
});

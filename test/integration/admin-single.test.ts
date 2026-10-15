import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminApp } from "../../src/admin/app.js";
import { testFs } from "../helpers.js";

/** LISTEN=single mounts the admin UI at /admin: every link, form and redirect must stay under it. */
let hub: Hub, app: Hono, cookie = "";
const BASE = "http://10.0.0.2";
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-as-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-asv-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.settings.set("modules", { ledger: { enabled: true } });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "10.0.0.9"), n())).route("/admin", adminApp(hub, { vaultRoots: [], builtinVault: "", base: "/admin" }));
});

const internalLinks = (html: string) => [...html.matchAll(/\b(?:href|action|formaction)="(\/[^"]*)"/g)].map((m) => m[1]!);

describe("admin under /admin", () => {
  it("redirects stay under the prefix", async () => {
    expect((await app.request(`${BASE}/admin/`)).headers.get("location")).toBe("/admin/login");
    const login = await app.request(`${BASE}/admin/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=owner&password=a-long-test-password" });
    expect(login.headers.get("location")).toBe("/admin");
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  });
  it("every link and form on the pages stays under the prefix", async () => {
    for (const page of ["/admin", "/admin/ledger/recipes"]) {
      const res = await app.request(`${BASE}${page}`, { headers: { cookie } });
      expect(res.status, page).toBe(200);
      const html = await res.text();
      const links = internalLinks(html);
      expect(links.length).toBeGreaterThan(5);
      expect(links.filter((l) => !/^\/admin(\/|#|$)/.test(l)), page).toEqual([]);
    }
  });
});

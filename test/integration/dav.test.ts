import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { ingestApp } from "../../src/http/ingest.js";
import { davPath } from "../../src/http/dav.js";
import { testFs } from "../helpers.js";

const root = mkdtempSync(join(tmpdir(), "mx-dav-"));
const outside = mkdtempSync(join(tmpdir(), "mx-dav-outside-"));
let hub: Hub, app: Hono, dav = "", ledger = "";
const req = (method: string, path: string, o: { tok?: string; body?: BodyInit; headers?: Record<string, string> } = {}) =>
  app.request(`https://hub.example.com${path}`, { method, body: o.body, headers: { ...(o.tok !== "" ? { authorization: `Basic ${btoa(`phone:${o.tok ?? dav}`)}` } : {}), ...(o.headers ?? {}) } });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-davd-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(root)]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.7"), n())).route("/", ingestApp(hub));
  dav = (await hub.ingestTokens.create("phone", ["dav"], "t")).token;
  ledger = (await hub.ingestTokens.create("other", ["ledger"], "t")).token;
  writeFileSync(join(outside, "secret.md"), "outside the vault");
});

describe("built-in WebDAV", () => {
  it("is off by default", async () => {
    expect((await req("PROPFIND", "/dav/")).status).toBe(404);
    await hub.settings.set("dav", { enabled: true, maxFileMb: 1 });
    await hub.reload();
  });

  it("needs a device token with scope dav", async () => {
    const r = await req("PROPFIND", "/dav/", { tok: "" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect((await req("PROPFIND", "/dav/", { tok: ledger })).status).toBe(401);
    expect((await req("PROPFIND", "/dav/", { tok: "mxi_wrong" })).status).toBe(401);
  });

  it("puts, gets (bytes), lists and updates with preconditions", async () => {
    expect((await req("OPTIONS", "/dav/")).headers.get("dav")).toBe("1");
    expect((await req("PUT", "/dav/notes/a%20b.md", { body: "hello" })).status).toBe(201);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2]);
    expect((await req("PUT", "/dav/att/pic.png", { body: png })).status).toBe(201);
    const g = await req("GET", "/dav/att/pic.png");
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(png);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("content-security-policy")).toContain("sandbox");
    const etag = (await req("HEAD", "/dav/notes/a%20b.md")).headers.get("etag")!;
    expect((await req("PUT", "/dav/notes/a%20b.md", { body: "x", headers: { "if-match": '"stale"' } })).status).toBe(412);
    expect((await req("PUT", "/dav/notes/a%20b.md", { body: "v2", headers: { "if-match": etag } })).status).toBe(204);
    expect((await req("PUT", "/dav/notes/a%20b.md", { body: "v3", headers: { "if-none-match": "*" } })).status).toBe(412);
    expect(readFileSync(join(root, "notes", "a b.md"), "utf8")).toBe("v2");
    const list = await (await req("PROPFIND", "/dav/notes/", { headers: { depth: "1" } })).text();
    expect(list).toContain("<d:href>/dav/notes/a%20b.md</d:href>");
    expect(list).toContain("<d:href>/dav/notes/</d:href>");
    expect((await req("PROPFIND", "/dav/", { headers: { depth: "infinity" } })).status).toBe(403);
  });

  it("deletes into a hidden trash, makes folders and moves", async () => {
    expect((await req("DELETE", "/dav/notes/a%20b.md")).status).toBe(204);
    expect(existsSync(join(root, "notes", "a b.md"))).toBe(false);
    expect(await (await req("PROPFIND", "/dav/", { headers: { depth: "1" } })).text()).not.toContain(".trash");
    expect((await req("GET", "/dav/.trash/")).status).toBe(400);
    expect((await req("MKCOL", "/dav/new")).status).toBe(201);
    await req("PUT", "/dav/m1.md", { body: "1" });
    await req("PUT", "/dav/m2.md", { body: "2" });
    expect((await req("MOVE", "/dav/m1.md", { headers: { destination: "https://hub.example.com/dav/m2.md", overwrite: "F" } })).status).toBe(412);
    expect((await req("MOVE", "/dav/m1.md", { headers: { destination: "/dav/new/m1.md" } })).status).toBe(201);
    expect(readFileSync(join(root, "new", "m1.md"), "utf8")).toBe("1");
    expect((await req("MOVE", "/dav/m2.md", { headers: { destination: "/elsewhere/x.md" } })).status).toBe(400);
  });

  it("cannot escape the vault: traversal, links and size", async () => {
    expect(davPath("/dav/a/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    // URL parsing already folds "%2e%2e"; either way the request never reaches a file outside /dav.
    expect([400, 404]).toContain((await req("GET", "/dav/a/%2e%2e/%2e%2e/x.md")).status);
    expect([400, 404]).toContain((await req("PUT", "/dav/%2e%2e/escape.md", { body: "x" })).status);
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false);
    expect((await req("PUT", "/dav/a%5Cb.md", { body: "x" })).status).toBe(400);
    symlinkSync(outside, join(root, "link"));
    expect((await req("GET", "/dav/link/secret.md")).status).toBe(403);
    expect((await req("PUT", "/dav/link/new.md", { body: "x" })).status).toBe(403);
    expect(existsSync(join(outside, "new.md"))).toBe(false);
    expect(await (await req("PROPFIND", "/dav/", { headers: { depth: "1" } })).text()).not.toContain("/dav/link");
    expect((await req("PUT", "/dav/big.bin", { body: new Uint8Array(2 * 1024 * 1024) })).status).toBe(413);
  });
});

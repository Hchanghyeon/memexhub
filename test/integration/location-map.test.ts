import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { defineProvider } from "../../src/providers/types.js";
import { osmTilesProvider } from "../../src/providers/maptiles/osm.js";
import { T } from "../../src/core/i18n.js";
import type { Point } from "../../src/providers/location/types.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

const T0 = Date.parse("2026-10-14T00:00:00+09:00") / 1000;
const pts: Point[] = [];
for (let i = 0; i <= 60; i++) pts.push({ t: T0 + 8 * 3600 + i * 60, lat: 37.5, lon: 127.0 }); // 08:00–09:00
for (let i = 1; i <= 20; i++) pts.push({ t: T0 + 9 * 3600 + i * 90, lat: 37.5 + i * 0.0005, lon: 127.0 }); // walking
for (let i = 0; i <= 30; i++) pts.push({ t: T0 + 10 * 3600 + i * 60, lat: 37.51, lon: 127.0 }); // 10:00–10:30
const fakeLoc = defineProvider({
  kind: "location", id: "fakeloc", title: T("f", "f"), config: z.object({}), runtimes: ["node"],
  create: () => ({ points: async (a: Date, b: Date) => pts.filter((p) => p.t >= +a / 1000 && p.t < +b / 1000), areas: async () => [{ name: "Home", lat: 37.5, lon: 127.0, radius: 100 }] }),
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const asked: string[] = [];
const fakeFetch = (async (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u instanceof Request ? u.url : u);
  asked.push(`${url} ${(init?.headers as Record<string, string>)?.["user-agent"] ?? ""}`);
  if (url.includes("/9/9/9.png")) return new Response("<html>oops</html>", { headers: { "content-type": "text/html" } });
  return new Response(PNG, { headers: { "content-type": "image/png" } });
}) as typeof fetch;

let hub: Hub, a: ReturnType<typeof adminClient>;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-map-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T03:00:00Z"), fetch: fakeFetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-mapv-"))), fakeLoc, osmTilesProvider]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  await hub.connections.upsert({ kind: "location", provider: "fakeloc", name: "phone", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("modules", { location: { enabled: true } });
  await hub.reload();
  a = adminClient(hub);
  await a.login();
});

describe("map screen API", () => {
  it("gives one day's path and stays, and says when the map background is off", async () => {
    const d = await a.json("/location/day?date=2026-10-14");
    expect(d.connected).toBe(true);
    expect(d.tiles).toBeNull();
    expect(d.path.length).toBe(pts.length);
    expect(d.path[0]).toEqual([37.5, 127.0, T0 + 8 * 3600]);
    expect(d.stays.map((s: { name: string; named: boolean }) => [s.name, s.named])).toEqual([["Home", true], ["", false]]); // no geocoder: no name
    expect(d.stays[0].minutes).toBeGreaterThanOrEqual(60);
    expect(d.stays[1].minutes).toBeGreaterThanOrEqual(30); // walking points near a place join its stay
    expect(d.km).toBeGreaterThan(1);
    expect((await a.json("/location/day?date=2026-10-13")).path).toEqual([]);
    expect((await a.get("/location/day?date=yesterday")).status).toBe(400);
    expect((await a.get("/map/tile/3/1/1")).status).toBe(404); // no tile connection yet
  });

  it("fetches a tile once through the server, caches it, and refuses non-pictures and bad numbers", async () => {
    expect((await a.post("/connections", { provider: "maptiles:osm", name: "map", config: {}, secrets: {} })).status).toBe(200);
    expect((await a.json("/location/day?date=2026-10-14")).tiles.attribution).toContain("OpenStreetMap");
    for (let i = 0; i < 2; i++) {
      const r = await a.get("/map/tile/15/27948/12700");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    }
    const calls = asked.filter((x) => x.includes("/15/27948/12700.png"));
    expect(calls).toHaveLength(1); // the second view came from the cache
    expect(calls[0]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/15\/27948\/12700\.png memexhub/);
    expect((await a.get("/map/tile/9/9/9")).status).toBe(404); // the server sent HTML, not a picture
    for (const p of ["/map/tile/20/1/1", "/map/tile/2/4/0", "/map/tile/2/0/4", "/map/tile/-1/0/0", "/map/tile/a/b/c", "/map/tile/3/1/1.png"]) expect((await a.get(p)).status, p).toBe(400);
  });

  it("needs a signed-in admin", async () => {
    const anon = adminClient(hub);
    expect((await anon.get("/location/day?date=2026-10-14")).status).toBe(401);
    expect((await anon.get("/map/tile/15/27948/12700")).status).toBe(401);
  });
});

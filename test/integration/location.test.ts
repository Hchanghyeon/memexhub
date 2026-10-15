import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hono } from "hono";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { defineProvider } from "../../src/providers/types.js";
import { owntracksProvider } from "../../src/providers/location/owntracks.js";
import { T } from "../../src/core/i18n.js";
import { ingestApp } from "../../src/http/ingest.js";
import type { Geocoder, Point } from "../../src/providers/location/types.js";
import { testFs } from "../helpers.js";

const T0 = Date.parse("2026-10-14T00:00:00+09:00") / 1000; // local midnight
const HOME = { lat: 37.5, lon: 127.0 };
const CAFE = { lat: 37.51, lon: 127.0 };
const pts: Point[] = [];
for (let i = 0; i <= 60; i++) pts.push({ t: T0 + 8 * 3600 + i * 60, ...HOME }); // 08:00–09:00 home
for (let i = 0; i <= 30; i++) pts.push({ t: T0 + 10 * 3600 + i * 60, ...CAFE }); // 10:00–10:30 cafe
const fakeLoc = defineProvider({
  kind: "location", id: "fakeloc", title: T("f", "f"), config: z.object({}), runtimes: ["node"],
  create: () => ({
    points: async (a: Date, b: Date) => pts.filter((p) => p.t >= +a / 1000 && p.t < +b / 1000),
    areas: async () => [{ name: "집", ...HOME, radius: 100 }],
    visits: async () => [{ name: "샘플동 12-3", start: T0 + 13 * 3600, end: T0 + 13 * 3600 + 600 }],
  }),
});
let geoCalls = 0;
const fakeGeo = defineProvider({
  kind: "geocoder", id: "fakegeo", title: T("f", "f"), config: z.object({}), runtimes: ["node"],
  create: (): Geocoder => ({ reverse: async () => (geoCalls++, { poi: "샘플카페", kind: "amenity/cafe", area: "샘플시 샘플동 77-1" }) }),
});

let hub: Hub, app: Hono, token = "";
const tool = (n: string) => hub.tools.find((t) => t.name === n)!;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-lo-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T03:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-lov-"))), fakeLoc, fakeGeo, owntracksProvider]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  await hub.connections.upsert({ kind: "location", provider: "fakeloc", name: "dawarich", config: {} }, "t");
  await hub.connections.upsert({ kind: "location", provider: "owntracks", name: "phone", config: { areas: "Office, 37.6, 127.1, 100" } }, "t");
  await hub.connections.upsert({ kind: "geocoder", provider: "fakegeo", name: "osm", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("location", { ...s.location, connection: "dawarich", language: "ko" });
  await hub.settings.set("ledger", { ...s.ledger, language: "ko" });
  await hub.settings.set("modules", { ledger: { enabled: true }, location: { enabled: true } });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", ingestApp(hub));
  token = (await hub.ingestTokens.create("phone", ["location", "ledger"], "t")).token;
});

describe("location_day", () => {
  it("shows stays with names, never coordinates or street numbers", async () => {
    const out = await tool("location_day").run({ date: "2026-10-14" }, { actor: "t" });
    expect(out).toContain("# 2026-10-14 (수) 위치 요약");
    expect(out).toMatch(/1\. 08:00–09:00 \(1시간 0분\) · \[등록된 장소\] 집/);
    expect(out).toMatch(/2\. 10:00–10:30 .* 가까운 장소: 샘플카페 \(amenity\/cafe\) · 동네: 샘플시 샘플동 · .* 직전 체류 후 60분 이동/);
    expect(out).toContain("13:00–13:10 · 샘플동 · ⚠");
    expect(out).not.toMatch(/37\.5|127\.0|77-1|12-3/);
    expect(await tool("location_day").run({ date: "2026-10-01" }, { actor: "t" })).toBe("2026-10-01 위치 기록 없음");
  });
  it("hides private areas", async () => {
    const s = await hub.settings.get();
    await hub.settings.set("location", { ...s.location, privateAreas: ["집"] });
    await hub.reload();
    const out = await tool("location_day").run({ date: "2026-10-14" }, { actor: "t" });
    expect(out).toContain("(비공개 장소)");
    expect(out).not.toContain("집");
    await hub.settings.set("location", { ...s.location, privateAreas: [] });
    await hub.reload();
  });
});

describe("payment places", () => {
  it("names a payment from its coordinates through the location sources", async () => {
    const r = await app.request("https://hub.example.com/ingest/transaction", {
      method: "POST", headers: { "x-ingest-token": token, "content-type": "application/json" },
      body: JSON.stringify({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card", lat: CAFE.lat, lon: CAFE.lon }),
    });
    expect(r.status).toBe(200);
    const note = (await hub.vault!.read("ledger/payments/2026.md")).text;
    expect(note).toContain("| Sample Cafe @ 샘플동 | ₩4,500 |");
    expect(note).not.toMatch(/37\.51|77-1/);
  });
});

describe("OwnTracks ingest", () => {
  it("stores location points in the database only, ignores other message types", async () => {
    const post = (b: unknown) => app.request("https://hub.example.com/ingest/owntracks", { method: "POST", headers: { "x-ingest-token": token, "content-type": "application/json" }, body: JSON.stringify(b) });
    const r = await post([{ _type: "location", lat: 37.6, lon: 127.1, tst: T0 + 20 * 3600, acc: 12 }, { _type: "transition" }, { _type: "location", lat: 999, lon: 0, tst: 1 }]);
    expect(await r.json()).toMatchObject({ stored: 1 });
    const s = await hub.settings.get();
    await hub.settings.set("location", { ...s.location, connection: "phone" });
    await hub.reload();
    expect(await tool("location_day").run({ date: "2026-10-14" }, { actor: "t" })).toContain("점 1개");
    expect(JSON.stringify(await hub.vault!.list())).not.toContain("owntracks");
  });
});

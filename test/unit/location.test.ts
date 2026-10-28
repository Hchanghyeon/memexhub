import { describe, expect, it } from "vitest";
import { areaAt, cleanPoints, distanceM, pathKm, stays, stripLot } from "../../src/providers/location/stays.js";
import { Dawarich } from "../../src/providers/location/dawarich.js";
import { parseAreas, StoredPoints } from "../../src/providers/location/owntracks.js";
import { Nominatim } from "../../src/providers/geocoder/nominatim.js";
import { migrate } from "../../src/core/migrations.js";
import { sqliteDb } from "../../src/platform/node.js";
import type { Point } from "../../src/providers/location/types.js";

/** Fake track: 30 min at A (with jitter), a 2 km ride, 20 min at B, 5 min at C, 25 min back near A. */
const T0 = Date.parse("2026-10-14T00:00:00Z") / 1000;
const A = { lat: 37.5, lon: 127.0 };
const B = { lat: 37.518, lon: 127.0 };
function track(): Point[] {
  const pts: Point[] = [];
  let t = T0;
  for (let i = 0; i <= 30; i++, t += 60) pts.push({ t, lat: A.lat + (i % 2 ? 0.0003 : -0.0003), lon: A.lon, acc: 10 });
  for (let i = 1; i <= 9; i++, t += 60) pts.push({ t, lat: A.lat + (0.018 * i) / 10, lon: A.lon });
  for (let i = 0; i <= 20; i++, t += 60) pts.push({ t, lat: B.lat, lon: B.lon + 0.0001 * (i % 3) });
  pts.push({ t: t + 30, lat: 10, lon: 10, acc: 5000 }); // a wild fix
  for (let i = 0; i <= 5; i++, t += 60) pts.push({ t, lat: 37.53, lon: 127.0 });
  for (let i = 0; i <= 25; i++, t += 60) pts.push({ t, lat: A.lat + 0.001, lon: A.lon });
  return pts;
}

describe("stays", () => {
  it("finds stays, drops short ones and wild fixes, merges jitter", () => {
    const pts = cleanPoints(track());
    expect(pts.some((p) => p.lat === 10)).toBe(false);
    const s = stays(pts);
    expect(s.map((x) => Math.round((x.end - x.start) / 60))).toEqual([30, 20, 25]);
    expect(distanceM(s[1]!.lat, s[1]!.lon, B.lat, B.lon)).toBeLessThan(30);
    expect(pathKm(pts)).toBeGreaterThan(5);
    expect(pathKm(pts)).toBeLessThan(10);
  });
  it("leaves GPS jitter and wild fixes out of the distance", () => {
    // Two hours at one place, a fix every 10 s wobbling ±20 m (acc 25 m): no distance at all.
    const still: { t: number; lat: number; lon: number; acc: number }[] = [];
    for (let i = 0; i < 720; i++) still.push({ t: 1_000 + i * 10, lat: A.lat + (i % 2 ? 0.00018 : -0.00018), lon: A.lon, acc: 25 });
    expect(pathKm(still)).toBe(0);
    // A real 1 km walk in 50 m steps, with one fix 30 km away in the middle: about 1 km.
    const walk: { t: number; lat: number; lon: number; acc?: number }[] = [];
    for (let i = 0; i <= 20; i++) walk.push({ t: 10_000 + i * 40, lat: A.lat + i * 0.00045, lon: A.lon, acc: 8 });
    walk.splice(10, 0, { t: 10_000 + 9 * 40 + 20, lat: A.lat + 0.27, lon: A.lon, acc: 8 });
    expect(pathKm(walk)).toBeGreaterThan(0.95);
    expect(pathKm(walk)).toBeLessThan(1.05);
  });
  it("names areas and strips lot numbers", () => {
    expect(areaAt([{ name: "Home", ...A, radius: 100 }], A.lat + 0.001, A.lon)?.name).toBe("Home");
    expect(areaAt([{ name: "Home", ...A, radius: 100 }], B.lat, B.lon)).toBeUndefined();
    expect(stripLot("샘플동 1249-1")).toBe("샘플동");
    expect(stripLot("샘플동 산12")).toBe("샘플동");
    expect(stripLot("Sample Station")).toBe("Sample Station");
  });
  it("parses typed areas and ignores bad lines", () => {
    expect(parseAreas("Home, 37.5, 127.0, 120\nbad line\nOffice,37.51,127.01\nX, 999, 0, 10")).toEqual([
      { name: "Home", lat: 37.5, lon: 127, radius: 120 },
      { name: "Office", lat: 37.51, lon: 127.01, radius: 100 },
    ]);
  });
});

describe("providers", () => {
  it("Dawarich pages through points and sends the key", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (u: URL, init: RequestInit) => {
      seen.push({ url: String(u), headers: init.headers as Record<string, string> });
      const page = Number(u.searchParams.get("page") ?? 1);
      if (u.pathname.endsWith("/points"))
        return new Response(JSON.stringify([{ timestamp: T0 + page, latitude: "37.5", longitude: "127.0", accuracy: 8 }, { timestamp: "x" }]), { headers: { "x-total-pages": "2" } });
      return new Response(JSON.stringify([{ name: "Home", latitude: 37.5, longitude: 127, radius: 80 }, { name: "" }]));
    }) as unknown as typeof fetch;
    const d = new Dawarich({ url: "http://dawarich.example.com/", apiKey: "k" }, f);
    expect((await d.points(new Date(T0 * 1000), new Date((T0 + 86400) * 1000))).map((p) => p.t)).toEqual([T0 + 1, T0 + 2]);
    expect(await d.areas()).toEqual([{ name: "Home", lat: 37.5, lon: 127, radius: 80 }]);
    expect(seen[0]!.url).toMatch(/^http:\/\/dawarich\.example\.com\/api\/v1\/points\?/);
    expect(seen[0]!.headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("stored points and Nominatim with cache and rate limit", async () => {
    const db = sqliteDb(":memory:");
    await migrate(db);
    await db.run(`INSERT INTO location_points (t, lat, lon, acc) VALUES (?, 37.5, 127.0, 5), (?, 37.6, 127.1, NULL)`, [T0, T0 + 99_999]);
    const sp = new StoredPoints(db, []);
    expect(await sp.points(new Date(T0 * 1000), new Date((T0 + 86400) * 1000))).toEqual([{ t: T0, lat: 37.5, lon: 127, acc: 5 }]);
    let calls = 0;
    const f = (async (u: URL, init: RequestInit) => {
      calls++;
      expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/^memexhub/);
      expect(u.searchParams.get("accept-language")).toBe("ko");
      return new Response(JSON.stringify({ name: "샘플역", category: "railway", type: "station", address: { city: "샘플시", borough: "샘플구", quarter: "샘플동" } }));
    }) as unknown as typeof fetch;
    const g = new Nominatim({ url: "https://nominatim.example.com", language: "ko", userAgent: "memexhub (test)" }, f, db);
    const t0 = Date.now();
    expect(await g.reverse(37.50001, 127.00001)).toEqual({ poi: "샘플역", kind: "railway/station", area: "샘플시 샘플구 샘플동" });
    expect(await g.reverse(37.50002, 127.00002)).toEqual({ poi: "샘플역", kind: "railway/station", area: "샘플시 샘플구 샘플동" }); // cached
    expect(calls).toBe(1);
    await g.reverse(37.6, 127.1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000); // ≤ 1 request per second
    expect(calls).toBe(2);
  });
});

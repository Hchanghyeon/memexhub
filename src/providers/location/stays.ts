import type { Area, Point } from "./types.js";

/** Pure geometry: stays (where you stayed, how long) and path distance. No I/O. */
export interface StayOptions {
  radiusM: number; // points within this radius of the running centre belong to one stay
  minMinutes: number; // shorter stays are dropped
  mergeM: number; // neighbouring stays closer than this are merged (GPS jitter)
}
export const DEFAULT_STAY: StayOptions = { radiusM: 150, minMinutes: 15, mergeM: 200 };

export interface Stay {
  lat: number;
  lon: number;
  start: number;
  end: number;
  n: number;
}

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const p1 = aLat * rad;
  const p2 = bLat * rad;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Drop wildly inaccurate fixes (> 1 km) and sort. */
export const cleanPoints = (pts: Point[]) => pts.filter((p) => !(typeof p.acc === "number" && p.acc > 1000)).sort((a, b) => a.t - b.t);

export function stays(points: Point[], o: StayOptions = DEFAULT_STAY): Stay[] {
  const out: Stay[] = [];
  let cur: Stay | undefined;
  for (const p of points) {
    if (cur && distanceM(cur.lat, cur.lon, p.lat, p.lon) <= o.radiusM) {
      const n = cur.n + 1;
      cur.lat += (p.lat - cur.lat) / n;
      cur.lon += (p.lon - cur.lon) / n;
      cur.n = n;
      cur.end = p.t;
      continue;
    }
    if (cur) out.push(cur);
    cur = { lat: p.lat, lon: p.lon, start: p.t, end: p.t, n: 1 };
  }
  if (cur) out.push(cur);
  const merged: Stay[] = [];
  for (const s of out) {
    const m = merged[merged.length - 1];
    if (m && distanceM(m.lat, m.lon, s.lat, s.lon) <= o.mergeM) {
      m.end = s.end;
      m.n += s.n;
    } else merged.push({ ...s });
  }
  return merged.filter((s) => s.end - s.start >= o.minMinutes * 60);
}

export const pathKm = (pts: Point[]) => pts.slice(1).reduce((sum, p, i) => sum + distanceM(pts[i]!.lat, pts[i]!.lon, p.lat, p.lon), 0) / 1000;

/** The named area a point is in (radius + 50 m tolerance), if any. */
export const areaAt = (areas: Area[], lat: number, lon: number) => areas.find((a) => distanceM(a.lat, a.lon, lat, lon) <= a.radius + 50);

/** "샘플동 1249-1" · "샘플동 산12" → without the lot number, so no street-level address reaches the vault. */
export const stripLot = (name: string) => name.replace(/(\s+(산\s*)?\d+(-\d+)?(번지)?)+\s*$/, "").trim();

import type { Area, Geocoder, LocationProvider } from "../../providers/location/types.js";
import { areaAt, distanceM, stripLot } from "../../providers/location/stays.js";
import type { PlaceResolver } from "../ledger/record.js";

const TRANSIT = /^(railway|public_transport)\/|^amenity\/bus_station$/;

/**
 * Coordinates → a name that may be written to the vault: a named area > a station's name > the neighbourhood.
 * Never coordinates, never a street number. Private areas resolve to "".
 */
export function placeResolver(
  get: () => Promise<{ loc?: LocationProvider; geo?: Geocoder }>,
  o: { privateAreas: () => string[]; now?: () => number; places?: () => Area[] },
): PlaceResolver & { areas(): Promise<Area[]> } {
  let cache: { at: number; areas: Area[] } | undefined;
  const now = o.now ?? (() => Date.now());
  const areas = async () => {
    if (cache && now() - cache.at < 10 * 60_000) return cache.areas;
    const { loc } = await get();
    // Places named on the admin map first, then the provider's own areas.
    const list = [...(o.places?.() ?? []), ...(loc ? await loc.areas().catch(() => []) : [])];
    cache = { at: now(), areas: list };
    return list;
  };
  const nameAt = async (lat: number, lon: number) => {
    const a = areaAt(await areas(), lat, lon);
    if (a) return o.privateAreas().includes(a.name) ? "" : a.name;
    const { geo } = await get();
    if (!geo) return "";
    const r = await geo.reverse(lat, lon).catch(() => ({}) as { poi?: string; kind?: string; area?: string });
    if (r.poi && r.kind && TRANSIT.test(r.kind)) return r.poi;
    return stripLot(r.area ?? "");
  };
  return {
    areas,
    nameAt,
    async placeAt(when: Date) {
      const { loc } = await get();
      if (!loc) return undefined;
      const pts = await loc.points(new Date(+when - 600_000), new Date(+when + 600_000)).catch(() => []);
      if (!pts.length) return undefined;
      const t = +when / 1000;
      const p = pts.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best));
      return nameAt(p.lat, p.lon);
    },
  };
}


export interface Spot { lat: number; lon: number; visits: number; days: number; minutes: number; hint: string }

/**
 * Unnamed places you keep coming back to, worth a name: stays grouped within `radiusM`, kept when seen on at
 * least 2 days for 2 hours in all, or 4 times. Named areas and dismissed spots are left out. Most time first.
 */
export function frequentSpots(
  list: { start: number; end: number; lat: number; lon: number; day: string }[],
  o: { named: Area[]; dismissed: [number, number][]; radiusM?: number; max?: number },
): Omit<Spot, "hint">[] {
  const r = o.radiusM ?? 150;
  const groups: { lat: number; lon: number; w: number; visits: number; days: Set<string>; minutes: number }[] = [];
  for (const x of list) {
    if (areaAt(o.named, x.lat, x.lon)) continue;
    if (o.dismissed.some(([a, b]) => distanceM(a, b, x.lat, x.lon) <= r + 50)) continue;
    const min = (x.end - x.start) / 60;
    const g = groups.find((g) => distanceM(g.lat, g.lon, x.lat, x.lon) <= r);
    if (g) {
      // The centre moves toward where you stay longest.
      g.lat = (g.lat * g.w + x.lat * min) / (g.w + min);
      g.lon = (g.lon * g.w + x.lon * min) / (g.w + min);
      g.w += min;
      g.visits++;
      g.days.add(x.day);
      g.minutes += min;
    } else groups.push({ lat: x.lat, lon: x.lon, w: min, visits: 1, days: new Set([x.day]), minutes: min });
  }
  return groups
    .filter((g) => (g.days.size >= 2 && g.minutes >= 120) || g.visits >= 4)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, o.max ?? 5)
    .map((g) => ({ lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, visits: g.visits, days: g.days.size, minutes: Math.round(g.minutes) }));
}

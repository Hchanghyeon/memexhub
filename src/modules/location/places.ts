import type { Area, Geocoder, LocationProvider } from "../../providers/location/types.js";
import { areaAt, stripLot } from "../../providers/location/stays.js";
import type { PlaceResolver } from "../ledger/record.js";

const TRANSIT = /^(railway|public_transport)\/|^amenity\/bus_station$/;

/**
 * Coordinates → a name that may be written to the vault: a named area > a station's name > the neighbourhood.
 * Never coordinates, never a street number. Private areas resolve to "".
 */
export function placeResolver(
  get: () => Promise<{ loc?: LocationProvider; geo?: Geocoder }>,
  o: { privateAreas: () => string[]; now?: () => number },
): PlaceResolver & { areas(): Promise<Area[]> } {
  let cache: { at: number; areas: Area[] } | undefined;
  const now = o.now ?? (() => Date.now());
  const areas = async () => {
    if (cache && now() - cache.at < 10 * 60_000) return cache.areas;
    const { loc } = await get();
    const list = loc ? await loc.areas().catch(() => []) : [];
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


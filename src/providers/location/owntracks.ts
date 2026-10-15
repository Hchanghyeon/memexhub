import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import type { Db } from "../../platform/types.js";
import type { Area, LocationProvider, Point } from "./types.js";

/**
 * Points sent by the OwnTracks app (or anything speaking its HTTP format) to /ingest/owntracks,
 * stored in the database — never in the vault. Areas are typed in the connection form.
 */
export class StoredPoints implements LocationProvider {
  constructor(
    private db: Db,
    private areaList: Area[],
  ) {}
  async points(from: Date, to: Date): Promise<Point[]> {
    const rows = await this.db.all<{ t: number; lat: number; lon: number; acc: number | null }>(
      `SELECT t, lat, lon, acc FROM location_points WHERE t >= ? AND t < ? ORDER BY t LIMIT 50000`,
      [Math.floor(+from / 1000), Math.ceil(+to / 1000)],
    );
    return rows.map((r) => ({ t: r.t, lat: r.lat, lon: r.lon, acc: r.acc ?? undefined }));
  }
  async areas() {
    return this.areaList;
  }
}

/** "Home, 37.5, 127.0, 120" per line → areas. Bad lines are ignored. */
export function parseAreas(text: string): Area[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.split(",").map((x) => x.trim()))
    .filter((p) => p.length >= 3 && p[0])
    .map(([name, lat, lon, radius]) => ({ name: name!.slice(0, 60), lat: Number(lat), lon: Number(lon), radius: Number(radius) || 100 }))
    .filter((a) => Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && a.radius > 0 && a.radius <= 5000)
    .slice(0, 50);
}

export const owntracksProvider = defineProvider({
  kind: "location",
  id: "owntracks",
  title: T("OwnTracks (points sent to memexhub)", "OwnTracks (memexhub로 보낸 위치)"),
  config: z.object({
    areas: z.string().max(5000).default("").describe("Named places, one per line: name, latitude, longitude, radius in metres"),
  }),
  runtimes: ["node", "workers"],
  create: ({ config, platform }) => new StoredPoints(platform.db, parseAreas(config.areas)),
});

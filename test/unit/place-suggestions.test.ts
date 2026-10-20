import { describe, expect, it } from "vitest";
import { frequentSpots, placeResolver } from "../../src/modules/location/places.js";

const GYM = { lat: 37.5, lon: 127.0 };
const CAFE = { lat: 37.51, lon: 127.01 }; // about 1.4 km away
const stay = (p: { lat: number; lon: number }, day: string, minutes: number, jitter = 0) => ({ start: 0, end: minutes * 60, lat: p.lat + jitter, lon: p.lon, day });

describe("places worth a name", () => {
  it("groups repeated stays and keeps the ones you come back to", () => {
    const list = [
      stay(GYM, "2026-10-01", 70), stay(GYM, "2026-10-03", 65, 0.0003), stay(GYM, "2026-10-05", 60, -0.0002),
      stay(CAFE, "2026-10-02", 40), // once: not suggested
    ];
    const r = frequentSpots(list, { named: [], dismissed: [] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ visits: 3, days: 3, minutes: 195 });
    expect(Math.abs(r[0]!.lat - GYM.lat)).toBeLessThan(0.001);
  });

  it("leaves out named and dismissed places", () => {
    const list = [stay(GYM, "2026-10-01", 90), stay(GYM, "2026-10-02", 90)];
    expect(frequentSpots(list, { named: [{ name: "Gym", ...GYM, radius: 100 }], dismissed: [] })).toEqual([]);
    expect(frequentSpots(list, { named: [], dismissed: [[GYM.lat, GYM.lon]] })).toEqual([]);
  });

  it("names a stay by a place named on the admin map before the provider's areas and the geocoder", async () => {
    const r = placeResolver(async () => ({ loc: { areas: async () => [{ name: "Provider area", ...GYM, radius: 500 }] } as never }), { privateAreas: () => [], places: () => [{ name: "Gym", ...GYM, radius: 150 }] });
    expect(await r.nameAt!(GYM.lat, GYM.lon)).toBe("Gym");
  });
});

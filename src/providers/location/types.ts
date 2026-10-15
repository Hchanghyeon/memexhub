/** A location fix. `t` is unix seconds. Coordinates never go into the vault. */
export interface Point {
  t: number;
  lat: number;
  lon: number;
  acc?: number; // metres
}

/** A named circle the user drew ("Home", "Office"). Names win over any geocoder. */
export interface Area {
  name: string;
  lat: number;
  lon: number;
  radius: number; // metres
}

/** A visit detected by the phone app or the location server (optional). */
export interface Visit {
  name?: string;
  start: number;
  end: number;
}

/** Where location history comes from (Dawarich, OwnTracks …). Read-only. */
export interface LocationProvider {
  points(from: Date, to: Date): Promise<Point[]>;
  areas(): Promise<Area[]>;
  visits?(from: Date, to: Date): Promise<Visit[]>;
}

export interface ReverseResult {
  poi?: string; // nearest named place
  kind?: string; // "railway/station"
  area?: string; // "Seoul Gangnam-gu Yeoksam-dong"
}

/** Coordinates → place names (OpenStreetMap Nominatim …). */
export interface Geocoder {
  reverse(lat: number, lon: number): Promise<ReverseResult>;
}

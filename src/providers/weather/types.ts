/** One day of weather at the connection's place. Temperatures in °C, precipitation in mm. */
export interface WeatherDay {
  date: string; // YYYY-MM-DD
  code: number; // WMO weather code
  max: number | null;
  min: number | null;
  rain: number | null;
}

export interface WeatherProvider {
  /** Where (a label only — coordinates never leave the connection settings). */
  place: string;
  days(from: string, to: string): Promise<WeatherDay[]>;
}

import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import { addDays, localDate } from "../../core/time.js";
import type { WeatherDay, WeatherProvider } from "./types.js";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum";

/**
 * Open-Meteo: free, no key. Recent and coming days (−92 … +15) come from the forecast API, older days from the
 * archive. Coordinates are rounded to 0.01° (~1 km) before they are sent.
 */
export class OpenMeteo implements WeatherProvider {
  constructor(
    private o: { place: string; latitude: number; longitude: number; timezone: string },
    private f: typeof fetch,
    private now: () => Date = () => new Date(),
  ) {}

  get place() {
    return this.o.place;
  }

  async days(from: string, to: string): Promise<WeatherDay[]> {
    const today = localDate(this.o.timezone, this.now());
    const recent = addDays(today, -90);
    const parts: [string, string, string][] = [];
    if (from < recent) parts.push([ARCHIVE, from, to < recent ? to : addDays(recent, -1)]);
    if (to >= recent) parts.push([FORECAST, from > recent ? from : recent, to < addDays(today, 15) ? to : addDays(today, 15)]);
    const out: WeatherDay[] = [];
    for (const [base, a, b] of parts) {
      if (a > b) continue;
      const u = new URL(base);
      const q = { latitude: this.o.latitude.toFixed(2), longitude: this.o.longitude.toFixed(2), daily: DAILY, timezone: this.o.timezone, start_date: a, end_date: b };
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      const r = await this.f(u);
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const d = ((await r.json()) as { daily?: Record<string, unknown[]> }).daily ?? {};
      const time = (d.time ?? []) as string[];
      time.forEach((date, i) => {
        const n = (k: string) => (typeof d[k]?.[i] === "number" ? (d[k]![i] as number) : null);
        out.push({ date, code: n("weather_code") ?? -1, max: n("temperature_2m_max"), min: n("temperature_2m_min"), rain: n("precipitation_sum") });
      });
    }
    return out;
  }
}

export const openMeteoProvider = defineProvider({
  kind: "weather",
  id: "open-meteo",
  title: T("Open-Meteo weather (free, no key)", "Open-Meteo 날씨 (무료, 키 없음)"),
  config: z.object({
    place: z.string().min(1).max(60).meta(F("Place name", "장소 이름", ["Shown in summaries, e.g. Seoul or Home.", "요약에 보일 이름이에요. 예: 서울, 집."])),
    latitude: z.coerce.number().min(-90).max(90).meta(F("Latitude", "위도", ["Two decimals are enough, e.g. 37.57. In Google Maps, right-click the place: the first number.", "소수 둘째 자리면 충분해요. 예: 37.57. 구글 지도에서 그 장소를 오른쪽 클릭하면 나오는 첫 번째 숫자예요."])),
    longitude: z.coerce.number().min(-180).max(180).meta(F("Longitude", "경도", ["e.g. 126.98: the second number in Google Maps.", "예: 126.98. 구글 지도에서 나오는 두 번째 숫자예요."])),
  }),
  runtimes: ["node", "workers"],
  hosts: () => ["api.open-meteo.com", "archive-api.open-meteo.com"],
  create: ({ config, fetch, timezone, platform }) => new OpenMeteo({ place: config.place, latitude: config.latitude, longitude: config.longitude, timezone }, fetch, () => platform.now()),
  test: async (w) => {
    const today = localDate("UTC", new Date());
    if (!(await (w as OpenMeteo).days(today, today)).length) throw new Error("Open-Meteo returned no data");
  },
});

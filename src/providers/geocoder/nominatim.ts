import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import type { Db } from "../../platform/types.js";
import type { Geocoder, ReverseResult } from "../location/types.js";

/**
 * OpenStreetMap Nominatim reverse geocoding. Usage policy: ≤ 1 request per second, a real User-Agent,
 * results cached (rounded to ~10 m) in the database so the same place is asked once.
 */
export class Nominatim implements Geocoder {
  private static last = 0;
  constructor(
    private o: { url: string; language: string; userAgent: string },
    private f: typeof fetch,
    private db: Db,
    private now: () => number = () => Date.now(),
  ) {}

  async reverse(lat: number, lon: number): Promise<ReverseResult> {
    const key = `${this.o.language}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = await this.db.get<{ value: string }>(`SELECT value FROM geocode_cache WHERE key = ?`, [key]);
    if (hit) return JSON.parse(hit.value) as ReverseResult;
    const wait = 1100 - (this.now() - Nominatim.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    Nominatim.last = this.now();
    const u = new URL(`${this.o.url.replace(/\/+$/, "")}/reverse`);
    for (const [k, v] of Object.entries({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: "18", addressdetails: "1", "accept-language": this.o.language })) u.searchParams.set(k, v);
    let d: any;
    try {
      const r = await this.f(u, { headers: { "user-agent": this.o.userAgent, accept: "application/json" } });
      if (!r.ok) return {};
      d = await r.json();
    } catch {
      return {};
    }
    const a = d?.address ?? {};
    const area = [a.city ?? a.province, a.borough ?? a.county, a.quarter ?? a.suburb ?? a.neighbourhood].filter(Boolean).join(" ");
    const res: ReverseResult = { ...(d?.name ? { poi: String(d.name), kind: `${d.category}/${d.type}` } : {}), ...(area ? { area } : {}) };
    await this.db.run(`INSERT OR REPLACE INTO geocode_cache (key, value, at) VALUES (?, ?, ?)`, [key, JSON.stringify(res), new Date(this.now()).toISOString()]);
    return res;
  }
}

export const nominatimProvider = defineProvider({
  kind: "geocoder",
  id: "nominatim",
  title: T("OpenStreetMap Nominatim", "OpenStreetMap Nominatim"),
  config: z.object({
    url: z.string().url().default("https://nominatim.openstreetmap.org").meta(F("Place-name server address", "지명 서버 주소", ["The default public OpenStreetMap server is fine. Only change it if you run your own.", "기본값(공개 OpenStreetMap 서버)이면 돼요. 직접 운영하는 서버가 있을 때만 바꾸세요."])),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en").meta(F("Language of place names", "지명 언어", ["ko for Korean names (성북구 하월곡동), en for English.", "ko 면 한국어 지명(성북구 하월곡동), en 이면 영어예요."])),
    contact: z.string().max(100).optional().meta(F("Contact", "연락처", ["An email or web address sent with requests, as the public server's rules require. Never shown to anyone else.", "공개 서버 규칙에 따라 요청에 같이 보내는 메일이나 웹 주소예요. 다른 사람에게 보이지 않아요."])),
  }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  create: ({ config, fetch, platform }) =>
    new Nominatim({ url: config.url, language: config.language, userAgent: `memexhub (self-hosted; ${config.contact || "low volume"})` }, fetch, platform.db),
});

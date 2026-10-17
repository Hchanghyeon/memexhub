import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import type { Area, LocationProvider, Point, Visit } from "./types.js";

/** Dawarich (self-hosted location history) over its REST API. Read-only. */
export class Dawarich implements LocationProvider {
  constructor(
    private o: { url: string; apiKey: string },
    private f: typeof fetch,
  ) {}

  private async get(path: string, params: Record<string, string>) {
    const u = new URL(`${this.o.url.replace(/\/+$/, "")}/api/v1/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const headers: Record<string, string> = { authorization: `Bearer ${this.o.apiKey}`, accept: "application/json" };
    const r = await this.f(u, { headers });
    if (!r.ok) throw new Error(`dawarich ${path}: HTTP ${r.status}`);
    return { data: (await r.json()) as unknown, pages: Number(r.headers.get("x-total-pages") ?? 1) || 1 };
  }

  async points(from: Date, to: Date): Promise<Point[]> {
    const out: Point[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, pages } = await this.get("points", { start_at: from.toISOString(), end_at: to.toISOString(), per_page: "1000", page: String(page), order: "asc" });
      const list = Array.isArray(data) ? data : [];
      for (const p of list as any[]) {
        const t = Number(p.timestamp);
        const lat = Number(p.latitude);
        const lon = Number(p.longitude);
        if (Number.isFinite(t) && Number.isFinite(lat) && Number.isFinite(lon)) out.push({ t, lat, lon, acc: p.accuracy == null ? undefined : Number(p.accuracy) });
      }
      if (page >= pages || !list.length) break;
    }
    return out;
  }

  async areas(): Promise<Area[]> {
    const { data } = await this.get("areas", {});
    return (Array.isArray(data) ? data : [])
      .map((a: any) => ({ name: String(a.name ?? ""), lat: Number(a.latitude), lon: Number(a.longitude), radius: Number(a.radius) || 100 }))
      .filter((a) => a.name && Number.isFinite(a.lat) && Number.isFinite(a.lon));
  }

  async visits(from: Date, to: Date): Promise<Visit[]> {
    const { data } = await this.get("visits", { start_at: from.toISOString(), end_at: to.toISOString() });
    return (Array.isArray(data) ? data : [])
      .map((v: any) => ({ name: v.name ?? v.place?.name ?? undefined, start: Date.parse(v.started_at) / 1000, end: Date.parse(v.ended_at) / 1000 }))
      .filter((v) => Number.isFinite(v.start) && Number.isFinite(v.end));
  }
}

export const dawarichProvider = defineProvider({
  kind: "location",
  id: "dawarich",
  title: T("Dawarich", "Dawarich"),
  config: z.object({
    // Use an address Dawarich accepts (its APPLICATION_HOSTS), e.g. its public https name — fetch cannot override Host.
    url: z.string().url().meta(F("Dawarich address", "Dawarich 주소", ["The address listed in Dawarich's APPLICATION_HOSTS, e.g. https://location.example.com", "Dawarich 설정의 APPLICATION_HOSTS 에 적힌 주소예요. 예: https://location.example.com"])),
    allowPrivateNetwork: z.boolean().default(false).meta(F("The server is on my home network", "서버가 집 네트워크 안에 있어요", ["Tick when the address is a home address such as 192.168.x.x or http://nas.local. Leave it off for internet addresses.", "주소가 192.168.x.x, http://nas.local 처럼 집 안 주소면 체크하세요. 인터넷 주소면 끈 채로 두세요."])),
  }),
  secrets: z.object({ apiKey: z.string().min(1).meta(F("API key", "API 키", ["Dawarich → Account → API key", "Dawarich → Account(계정) 화면에 있는 API 키"])) }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new Dawarich({ url: config.url, apiKey: secrets.apiKey }, fetch),
  test: async (d) => {
    await d.areas();
  },
});

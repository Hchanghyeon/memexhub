import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import type { Db } from "../../platform/types.js";

/** Map background pictures (256 px tiles) for the admin map. */
export interface MapTiles {
  tile(z: number, x: number, y: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | undefined>;
  attribution: string;
}

const KEEP_DAYS = 30; // OpenStreetMap asks for at least 7 days of caching
const MAX_TILES = 4000; // ~80 MB of pictures at most

/**
 * Tiles fetched by the server and kept in the database, so the browser only talks to memexhub
 * and a place you look at twice is asked once. Follows the OpenStreetMap tile usage policy:
 * a real User-Agent, caching, no bulk downloads (only tiles a person is looking at).
 */
export class CachedTiles implements MapTiles {
  private writes = 0;
  constructor(
    private o: { url: string; userAgent: string; attribution: string },
    private f: typeof fetch,
    private db: Db,
    private now: () => number = () => Date.now(),
  ) {}

  get attribution() {
    return this.o.attribution;
  }

  async tile(z: number, x: number, y: number) {
    const key = `${z}/${x}/${y}`;
    const fresh = new Date(this.now() - KEEP_DAYS * 86_400_000).toISOString();
    const hit = await this.db.get<{ type: string; data: string }>(`SELECT type, data FROM map_tiles WHERE key = ? AND at > ?`, [key, fresh]);
    if (hit) return { type: hit.type, bytes: fromB64(hit.data) };
    let r: Response;
    try {
      r = await this.f(`${this.o.url.replace(/\/+$/, "")}/${key}.png`, { headers: { "user-agent": this.o.userAgent, accept: "image/png,image/*" } });
    } catch {
      return undefined;
    }
    const type = (r.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(type)) return undefined;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 512 * 1024) return undefined;
    await this.db.run(`INSERT OR REPLACE INTO map_tiles (key, type, data, at) VALUES (?, ?, ?, ?)`, [key, type, toB64(bytes), new Date(this.now()).toISOString()]);
    if (++this.writes % 100 === 0) await this.prune();
    return { type, bytes };
  }

  async prune() {
    await this.db.run(`DELETE FROM map_tiles WHERE at <= ?`, [new Date(this.now() - KEEP_DAYS * 86_400_000).toISOString()]);
    await this.db.run(`DELETE FROM map_tiles WHERE key NOT IN (SELECT key FROM map_tiles ORDER BY at DESC LIMIT ?)`, [MAX_TILES]);
  }
}

function toB64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const osmTilesProvider = defineProvider({
  kind: "maptiles",
  id: "osm",
  title: T("OpenStreetMap map background", "OpenStreetMap 지도 바탕"),
  config: z.object({
    url: z.string().url().default("https://tile.openstreetmap.org").meta(F("Map server address", "지도 서버 주소", ["/{z}/{x}/{y}.png is added at the end. The default public OpenStreetMap server is fine for one person.", "끝에 /{z}/{x}/{y}.png 가 붙어요. 혼자 쓰는 정도면 기본값(공개 OpenStreetMap 서버)으로 충분해요."])),
    contact: z.string().max(100).optional().meta(F("Contact (optional)", "연락처 (선택)", ["An email or web address sent with requests, as the public map server's rules ask. Never shown to anyone else.", "공개 지도 서버 규칙에 따라 요청에 같이 보내는 메일이나 웹 주소예요. 다른 사람에게 보이지 않아요."])),
  }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  create: ({ config, fetch, platform }) =>
    new CachedTiles({ url: config.url, userAgent: `memexhub (self-hosted; ${config.contact || "low volume"})`, attribution: "© OpenStreetMap contributors" }, fetch, platform.db, () => +platform.now()),
});

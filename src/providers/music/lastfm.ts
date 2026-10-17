import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
import type { MusicProvider, Play } from "./types.js";

const API = "https://ws.audioscrobbler.com/2.0/";

/** Last.fm scrobbles of one user (public API key; the account itself is never touched). */
export class LastFm implements MusicProvider {
  readonly history = true;
  constructor(
    private o: { user: string; apiKey: string },
    private f: typeof fetch,
  ) {}

  async plays(from: Date, to: Date): Promise<Play[]> {
    const out: Play[] = [];
    for (let page = 1; page <= 10; page++) {
      const u = new URL(API);
      const q = { method: "user.getrecenttracks", user: this.o.user, api_key: this.o.apiKey, format: "json", limit: "200", page: String(page), from: String(Math.floor(+from / 1000)), to: String(Math.floor(+to / 1000) - 1) };
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      const r = await this.f(u);
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok || j.error) throw new Error(`Last.fm: ${j.message ?? r.status}`);
      const rt = j.recenttracks ?? {};
      for (const t of ([] as any[]).concat(rt.track ?? [])) {
        if (t["@attr"]?.nowplaying || !t.date?.uts) continue;
        out.push({ at: new Date(Number(t.date.uts) * 1000).toISOString(), title: String(t.name ?? ""), artist: String(t.artist?.["#text"] ?? t.artist?.name ?? ""), ...(t.album?.["#text"] ? { album: String(t.album["#text"]) } : {}) });
      }
      if (page >= Number(rt["@attr"]?.totalPages ?? 1)) break;
    }
    return out;
  }
}

export const lastfmProvider = defineProvider({
  kind: "music",
  id: "lastfm",
  title: T("Last.fm (scrobbles)", "Last.fm (스크로블)"),
  config: z.object({ user: z.string().regex(/^[A-Za-z0-9_-]{2,15}$/).meta(F("Last.fm user name", "Last.fm 사용자 이름", ["The name in your profile address: last.fm/user/<name>.", "프로필 주소 last.fm/user/<이름> 의 이름이에요."])) }),
  secrets: z.object({ apiKey: z.string().regex(/^[a-f0-9]{32}$/i).meta(F("API key", "API 키", ["last.fm/api/account/create → any app name → copy the API key (32 characters).", "last.fm/api/account/create → 앱 이름은 아무거나 → API key(32자리)를 복사하세요."])) }),
  runtimes: ["node", "workers"],
  hosts: () => ["ws.audioscrobbler.com"],
  create: ({ config, secrets, fetch }) => new LastFm({ user: config.user, apiKey: secrets.apiKey }, fetch),
  test: async (m) => {
    await (m as LastFm).plays(new Date(Date.now() - 86_400_000), new Date());
  },
});

import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import type { MusicProvider, Play } from "./types.js";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export const SPOTIFY_SIGNIN = {
  provider: "spotify",
  title: "Spotify",
  auth: `${ACCOUNTS}/authorize`,
  token: `${ACCOUNTS}/api/token`,
  hosts: ["accounts.spotify.com", "api.spotify.com"],
  scopes: () => ["user-read-recently-played"],
  clientAuth: "basic" as const,
  whoField: "account",
  who: async (token: string, f: typeof fetch) => {
    const me = (await (await f(`${API}/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { display_name?: string; id?: string };
    return String(me.display_name ?? me.id ?? "");
  },
};

/** Spotify "recently played" (the API keeps only the last 50); memexhub stores plays as it sees them. */
export class Spotify implements MusicProvider {
  readonly history = false;
  private access?: { token: string; until: number };
  constructor(
    private o: { clientId: string; clientSecret: string; refreshToken?: string; save: (p: Record<string, string>) => Promise<void> },
    private f: typeof fetch,
    private now: () => number = () => Date.now(),
  ) {}

  private async token(force = false) {
    if (!this.o.refreshToken) throw new Error("not signed in — admin UI → Connections → Sign in with Spotify");
    if (!force && this.access && this.access.until > this.now() + 60_000) return this.access.token;
    const r = await this.f(SPOTIFY_SIGNIN.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${this.o.clientId}:${this.o.clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.o.refreshToken }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string };
    if (!r.ok || !j.access_token) throw new Error(`Spotify sign-in expired or revoked (${j.error ?? r.status}) — sign in again`);
    if (j.refresh_token && j.refresh_token !== this.o.refreshToken) {
      this.o.refreshToken = j.refresh_token; // Spotify may rotate it
      await this.o.save({ refreshToken: j.refresh_token });
    }
    this.access = { token: j.access_token, until: this.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  async plays(from: Date, to: Date): Promise<Play[]> {
    for (const retry of [false, true]) {
      const u = new URL(`${API}/me/player/recently-played`);
      u.searchParams.set("limit", "50");
      u.searchParams.set("after", String(+from));
      const r = await this.f(u, { headers: { authorization: `Bearer ${await this.token(retry)}` } });
      if (r.status === 401 && !retry) continue;
      if (!r.ok) throw new Error(`Spotify ${r.status}`);
      const items = (((await r.json()) as any).items ?? []) as any[];
      return items
        .map((i) => ({ at: new Date(i.played_at).toISOString(), title: String(i.track?.name ?? ""), artist: (i.track?.artists ?? []).map((a: any) => a.name).join(", "), ...(i.track?.album?.name ? { album: String(i.track.album.name) } : {}) }))
        .filter((p) => p.at >= from.toISOString() && p.at < to.toISOString());
    }
    return [];
  }
}

export const spotifyProvider = defineProvider({
  kind: "music",
  id: "spotify",
  title: T("Spotify (recently played)", "Spotify (최근 재생)"),
  config: z.object({
    clientId: z.string().regex(/^[a-f0-9]{32}$/i).describe("Client ID (developer.spotify.com → Dashboard → your app)"),
    account: z.string().max(200).optional().describe("@internal"),
  }),
  secrets: z.object({
    clientSecret: z.string().min(16).describe("Client secret"),
    refreshToken: z.string().optional().describe("@internal"),
  }),
  runtimes: ["node", "workers"],
  hosts: () => SPOTIFY_SIGNIN.hosts,
  create: ({ config, secrets, fetch, saveSecrets }) => new Spotify({ clientId: config.clientId, clientSecret: secrets.clientSecret, refreshToken: secrets.refreshToken, save: saveSecrets }, fetch),
  test: async (m) => {
    await (m as Spotify).plays(new Date(Date.now() - 3600_000), new Date());
  },
});

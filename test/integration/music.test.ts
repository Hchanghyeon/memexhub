import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { LastFm, lastfmProvider } from "../../src/providers/music/lastfm.js";
import { Spotify, spotifyProvider } from "../../src/providers/music/spotify.js";
import { mcpApp } from "../../src/http/mcp.js";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const lastfmApi = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  const page = Number(u.searchParams.get("page"));
  const t = (uts: number, name: string, artist: string) => ({ name, artist: { "#text": artist }, album: { "#text": "Sample Album" }, date: { uts: String(uts) } });
  if (page === 1) return json({ recenttracks: { "@attr": { totalPages: "2" }, track: [{ name: "Live now", artist: { "#text": "X" }, "@attr": { nowplaying: "true" } }, t(1792119600, "Song A", "Artist One")] } });
  return json({ recenttracks: { "@attr": { totalPages: "2" }, track: t(1792116000, "Song B", "Artist Two") } });
}) as unknown as typeof fetch;

let spotifyRefresh = "rt-1";
const spotifyCalls: string[] = [];
let recent = [{ played_at: "2026-10-16T01:00:00.000Z", track: { name: "Track 1", artists: [{ name: "Band" }], album: { name: "LP" } } }];
const spotifyApi = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  spotifyCalls.push(`${u.host}${u.pathname}`);
  if (u.href === "https://accounts.spotify.com/api/token") {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${btoa("0123456789abcdef0123456789abcdef:client-secret-123")}`);
    const p = new URLSearchParams(String(init!.body));
    if (p.get("grant_type") === "authorization_code") return json({ access_token: "at", refresh_token: "rt-1", expires_in: 3600 });
    if (p.get("refresh_token") !== spotifyRefresh) return json({ error: "invalid_grant" }, 400);
    spotifyRefresh = "rt-2"; // rotated
    return json({ access_token: "at", refresh_token: "rt-2", expires_in: 3600 });
  }
  if (u.pathname === "/v1/me") return json({ display_name: "Listener" });
  if (u.pathname === "/v1/me/player/recently-played") return json({ items: recent.filter((r) => +new Date(r.played_at) > Number(u.searchParams.get("after"))) });
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

describe("music providers", () => {
  it("Last.fm pages through scrobbles and skips the track playing now", async () => {
    const plays = await new LastFm({ user: "sample", apiKey: "a".repeat(32) }, lastfmApi).plays(new Date("2026-10-15T00:00:00Z"), new Date("2026-10-17T00:00:00Z"));
    expect(plays.map((p) => `${p.artist} — ${p.title}`)).toEqual(["Artist One — Song A", "Artist Two — Song B"]);
    expect(plays[0]!.at).toBe(new Date(1792119600 * 1000).toISOString());
  });

  it("Spotify stores a rotated refresh token", async () => {
    const saved: Record<string, string>[] = [];
    const s = new Spotify({ clientId: "0123456789abcdef0123456789abcdef", clientSecret: "client-secret-123", refreshToken: "rt-1", save: async (p) => void saved.push(p) }, spotifyApi);
    const plays = await s.plays(new Date("2026-10-16T00:00:00Z"), new Date("2026-10-17T00:00:00Z"));
    expect(plays).toEqual([{ at: "2026-10-16T01:00:00.000Z", title: "Track 1", artist: "Band", album: "LP" }]);
    expect(saved).toEqual([{ refreshToken: "rt-2" }]);
  });
});

describe("music module", () => {
  const mk = async (fetch: typeof globalThis.fetch, now: () => Date) => {
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-mu-")) });
    const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now, fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [lastfmProvider, spotifyProvider]);
    const log = console.log;
    console.log = () => {};
    await hub.init();
    console.log = log;
    await hub.settings.set("timezone", "Asia/Seoul");
    await hub.settings.set("modules", { music: { enabled: true } });
    return hub;
  };

  it("collects Spotify plays every 30 minutes without duplicates, and reports a day", async () => {
    spotifyRefresh = "rt-1";
    let now = new Date("2026-10-16T02:00:00Z");
    const hub = await mk(spotifyApi, () => now);
    const id = await hub.connections.upsert({ kind: "music", provider: "spotify", name: "spotify", config: { clientId: "0123456789abcdef0123456789abcdef" }, secrets: { clientSecret: "client-secret-123" } }, "t");
    // sign in: Spotify-specific scope and callback, Basic client auth, account label stored
    const url = new URL(await hub.signIns.get("spotify")!.start(id));
    expect(url.searchParams.get("scope")).toBe("user-read-recently-played");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.example.com/oauth/spotify/callback");
    const mcp = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", mcpApp(hub));
    const cb = await mcp.request(`https://hub.example.com/oauth/spotify/callback?state=${url.searchParams.get("state")}&code=good`);
    expect(await cb.text()).toContain("Listener");
    expect((await hub.connections.byId(id))!.config.account).toBe("Listener");
    await hub.reload();
    const job = hub.jobs.find((j) => j.job.id === "music-collect")!.job;
    await job.run();
    await job.run();
    recent = [...recent, { played_at: "2026-10-16T01:30:00.000Z", track: { name: "Track 2", artists: [{ name: "Band" }, { name: "Guest" }], album: { name: "LP" } } }];
    now = new Date("2026-10-16T02:30:00Z");
    await job.run();
    expect((await hub.bus.query(["music"])).map((e) => e.payload.title)).toEqual(["Track 1", "Track 2"]);
    const day = await hub.tools.find((t) => t.name === "music_day")!.run({ date: "2026-10-16" }, { actor: "t" });
    expect(day).toBe("2026-10-16: 2 tracks · most played: Band (1), Band, Guest (1)\n- 10:00 Band · Track 1\n- 10:30 Band, Guest · Track 2");
    expect(await hub.tools.find((t) => t.name === "day_summary")!.run({ date: "2026-10-16" }, { actor: "t" })).toContain("2 tracks");
  });

  it("asks Last.fm directly for any day", async () => {
    const hub = await mk(lastfmApi, () => new Date("2026-10-16T12:00:00Z"));
    await hub.connections.upsert({ kind: "music", provider: "lastfm", name: "lastfm", config: { user: "sample" }, secrets: { apiKey: "a".repeat(32) } }, "t");
    await hub.reload();
    expect(await hub.tools.find((t) => t.name === "music_day")!.run({ date: "2026-10-16" }, { actor: "t" })).toContain("Artist One · Song A");
  });
});

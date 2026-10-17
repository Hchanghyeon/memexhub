import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Cursors } from "../../core/cursors.js";
import { dayBounds, localDate, nowIn } from "../../core/time.js";
import type { MusicProvider, Play } from "../../providers/music/types.js";

const hm = (iso: string, tz: string) => {
  const p = nowIn(tz, new Date(iso));
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};
/** "23 tracks · most: Artist (5), Other (3)". */
export function musicLine(plays: Play[], lang: "en" | "ko") {
  const by = new Map<string, number>();
  for (const p of plays) by.set(p.artist, (by.get(p.artist) ?? 0) + 1);
  const top = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([a, n]) => `${a} (${n})`).join(", ");
  return lang === "ko" ? `음악 ${plays.length}곡 · 많이 들은 아티스트: ${top}` : `${plays.length} tracks · most played: ${top}`;
}

export default defineModule({
  id: "music",
  title: T("Music", "음악"),
  setup: async ({ provider, connections, settings, platform, bus }) => {
    const names = await connections("music");
    const tz = settings.timezone;
    const lang = settings.toolLanguage === "ko" ? "ko" : "en";
    const cursors = new Cursors(platform.db, () => platform.now());
    const all = async () => {
      const out: { name: string; p: MusicProvider }[] = [];
      for (const n of names) {
        const p = await provider<MusicProvider>("music", n);
        if (p) out.push({ name: n, p });
      }
      return out;
    };
    /** Services with a long history are asked directly; the others come from what the job stored. */
    const playsOn = async (date: string) => {
      const [from, to] = dayBounds(tz, date);
      const plays: Play[] = [];
      for (const { name, p } of await all()) {
        if (p.history) plays.push(...(await p.plays(from, to)));
        else plays.push(...(await bus.query(["music"], { from: from.toISOString(), to: to.toISOString() })).filter((e) => e.source === `music:${name}`).map((e) => ({ at: e.occurredAt, ...(e.payload as Omit<Play, "at">) })));
      }
      return plays.sort((a, b) => a.at.localeCompare(b.at));
    };
    return {
      jobs: [
        {
          // Spotify keeps only the last 50 plays: look every 30 minutes and keep what is new.
          id: "music-collect",
          everyMinutes: 30,
          run: async () => {
            for (const { name, p } of await all()) {
              if (p.history) continue;
              const key = `music.seen:${name}`;
              const last = (await cursors.get<{ at: string }>(key))?.at;
              const now = platform.now();
              const from = last ? new Date(last) : new Date(+now - 86_400_000);
              const fresh = (await p.plays(from, now)).filter((x) => !last || x.at > last);
              if (!fresh.length) continue;
              await bus.appendMany(fresh.map((x) => ({ type: "music", occurredAt: x.at, source: `music:${name}`, payload: { title: x.title, artist: x.artist, ...(x.album ? { album: x.album } : {}) } })));
              await cursors.set(key, { at: fresh.map((x) => x.at).sort().at(-1) });
            }
          },
        },
      ],
      summary: {
        async day(date) {
          const plays = await playsOn(date);
          return plays.length ? [musicLine(plays, lang)] : undefined;
        },
      },
      tools: [
        defineTool({
          name: "music_day",
          readOnly: true,
          description: T(
            "What was listened to on a day (time, artist, track), from Last.fm or Spotify. Default: today.",
            "그날 들은 음악 (시각·아티스트·곡), Last.fm 이나 Spotify 에서. 기본은 오늘.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
          async run({ date }) {
            if (!names.length) return "no music connection: admin UI → Connections → Last.fm or Spotify";
            const d = date ?? localDate(tz, platform.now());
            const plays = await playsOn(d);
            if (!plays.length) return `${d}: nothing played`;
            return [`${d}: ${musicLine(plays, lang)}`, ...plays.slice(-150).map((p) => `- ${hm(p.at, tz)} ${p.artist} · ${p.title}`)].join("\n");
          },
        }),
      ],
    };
  },
});

import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { addDays, dayBounds, localDate, nowIn, zonedIso } from "../../core/time.js";
import type { Geocoder, LocationProvider } from "../../providers/location/types.js";
import { areaAt, cleanPoints, pathKm, stays, stripLot } from "../../providers/location/stays.js";
import { placeResolver } from "./places.js";

const OwnTracks = z
  .object({ _type: z.string().max(20), lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), tst: z.number().int().optional(), acc: z.number().min(0).max(100_000).optional(), tid: z.string().max(4).optional() })
  .passthrough();

const L = {
  ko: {
    title: (d: string, w: string) => `# ${d} (${w}) 위치 요약`, dow: ["일", "월", "화", "수", "목", "금", "토"], none: (d: string) => `${d} 위치 기록 없음`,
    head: (n: number, a: string, b: string, km: string) => `점 ${n}개 · ${a}–${b} · 이동 약 ${km}km`,
    rule: (r: number, m: number) => `체류 기준: 반경 ${r}m 안에 ${m}분 이상`, stays: "## 체류", noStays: "(체류 없음)",
    dur: (m: number) => `${Math.floor(m / 60)}시간 ${m % 60}분`, known: "[등록된 장소]", poi: "가까운 장소", area: "동네", unnamed: "이름 못 찾음",
    gap: (m: number) => `직전 체류 후 ${m}분 이동`, pts: (n: number) => `점 ${n}개`, priv: "(비공개 장소)",
    visits: "## 참고: 위치 앱·서버가 추정한 방문 (체류를 우선)", noMatch: "⚠ 체류와 안 맞음 (잠깐 멈춤이거나 지하·터널 오차)",
    note: "주의: 가까운 장소는 좌표에서 가장 가까운 지도상의 장소일 뿐, 실제로 들른 곳과 다를 수 있다. 시간·동네·다른 기록과 맞을 때만 믿을 것.",
    areas: (s: string) => `등록된 장소: ${s || "없음"}`,
  },
  en: {
    title: (d: string, w: string) => `# ${d} (${w}) location`, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], none: (d: string) => `no location points on ${d}`,
    head: (n: number, a: string, b: string, km: string) => `${n} points · ${a}–${b} · about ${km} km travelled`,
    rule: (r: number, m: number) => `stay = within ${r} m for ${m}+ minutes`, stays: "## Stays", noStays: "(no stays)",
    dur: (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`, known: "[named place]", poi: "nearest place", area: "area", unnamed: "no name found",
    gap: (m: number) => `${m} min after the previous stay`, pts: (n: number) => `${n} points`, priv: "(private place)",
    visits: "## For reference: visits guessed by the app or server (prefer stays)", noMatch: "⚠ does not match a stay (brief stop or tunnel error)",
    note: "Note: the nearest place is only the closest mapped place to the coordinates and may not be where you were. Trust it only if time, area and other records agree.",
    areas: (s: string) => `named places: ${s || "none"}`,
  },
};

export default defineModule({
  id: "location",
  title: T("Location", "위치"),
  setup: ({ settings, provider, platform }) => {
    const s = () => settings.location;
    const get = async () => ({
      loc: await provider<LocationProvider>("location", s().connection).catch(() => undefined),
      geo: await provider<Geocoder>("geocoder", s().geocoder).catch(() => undefined),
    });
    const places = placeResolver(get, { privateAreas: () => s().privateAreas, now: () => +platform.now() });
    const tz = () => settings.timezone;
    const hhmm = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t * 1000));

    return {
      summary: {
        async day(date) {
          const { loc } = await get();
          if (!loc) return undefined;
          const [from, to] = dayBounds(tz(), date);
          const pts = cleanPoints(await loc.points(from, to));
          if (!pts.length) return undefined;
          const parts: string[] = [];
          for (const x of stays(pts, s().stay)) parts.push(`${hhmm(x.start)}–${hhmm(x.end)} ${(await places.nameAt!(x.lat, x.lon)) || (s().language === "ko" ? "(이름 없음)" : "(unnamed)")}`);
          return [`${parts.join(" → ") || (s().language === "ko" ? "체류 없음" : "no stays")} · ${pathKm(pts).toFixed(1)} km`];
        },
        async week(from, to) {
          const { loc } = await get();
          if (!loc) return undefined;
          const [a] = dayBounds(tz(), from);
          const [, b] = dayBounds(tz(), to);
          const pts = cleanPoints(await loc.points(a, b));
          let km = 0;
          let days = 0;
          for (let d = from; d <= to; d = addDays(d, 1)) {
            const [x, y] = dayBounds(tz(), d);
            const dp = pts.filter((p) => p.t >= +x / 1000 && p.t < +y / 1000);
            if (dp.length) days++;
            km += pathKm(dp);
          }
          const ko = s().language === "ko";
          return { lines: [], numbers: [{ label: ko ? "이동" : "travelled", value: km, unit: "km", decimals: 1 }, { label: ko ? "위치 기록 날" : "days with location", value: days }] };
        },
      },
      tools: [
        defineTool({
          name: "location_day",
          readOnly: true,
          description: T(
            "One day of location as stays (where and how long), with named places, nearby places and areas — never coordinates or street numbers.",
            "하루 위치를 '체류'(어디에 얼마나)로 — 등록된 장소, 가까운 장소, 동네 이름. 좌표·번지는 주지 않는다.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: today)") },
          async run(a) {
            const date = a.date ?? localDate(tz(), platform.now());
            const t = L[s().language];
            const { loc, geo } = await get();
            if (!loc) return "no location source connected — admin UI → Connections";
            const [y, m, d] = date.split("-").map(Number) as [number, number, number];
            const start = new Date(zonedIso(tz(), y, m, d, 0, 0));
            const next = new Date(+start + 36 * 3600_000);
            const n = nowIn(tz(), next);
            const end = new Date(zonedIso(tz(), n.y, n.m, n.d, 0, 0));
            const pts = cleanPoints(await loc.points(start, end));
            if (!pts.length) return t.none(date);
            const areas = await places.areas();
            const st = stays(pts, s().stay);
            const dow = t.dow[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
            const out = [t.title(date, dow), t.head(pts.length, hhmm(pts[0]!.t), hhmm(pts[pts.length - 1]!.t), pathKm(pts).toFixed(1)), t.rule(s().stay.radiusM, s().stay.minMinutes), "", t.stays];
            if (!st.length) out.push(t.noStays);
            let prev: number | undefined;
            for (const [i, x] of st.entries()) {
              const a = areaAt(areas, x.lat, x.lon);
              let where: string;
              if (a) where = s().privateAreas.includes(a.name) ? t.priv : `${t.known} ${a.name}`;
              else {
                const r = geo ? await geo.reverse(x.lat, x.lon).catch(() => ({}) as { poi?: string; kind?: string; area?: string }) : {};
                where = [r.poi && `${t.poi}: ${r.poi}${r.kind ? ` (${r.kind})` : ""}`, r.area && `${t.area}: ${stripLot(r.area)}`].filter(Boolean).join(" · ") || t.unnamed;
              }
              const gap = prev === undefined ? "" : ` · ${t.gap(Math.round((x.start - prev) / 60))}`;
              out.push(`${i + 1}. ${hhmm(x.start)}–${hhmm(x.end)} (${t.dur(Math.round((x.end - x.start) / 60))}) · ${where} · ${t.pts(x.n)}${gap}`);
              prev = x.end;
            }
            const visits = loc.visits ? await loc.visits(start, end).catch(() => []) : [];
            if (visits.length) {
              out.push("", t.visits);
              for (const v of visits) {
                const overlap = st.some((x) => Math.min(v.end, x.end) - Math.max(v.start, x.start) > 0.5 * Math.max(v.end - v.start, 1));
                out.push(`- ${hhmm(v.start)}–${hhmm(v.end)} · ${stripLot(v.name ?? "") || t.unnamed}${overlap ? "" : ` · ${t.noMatch}`}`);
              }
            }
            out.push("", t.note, t.areas(areas.filter((a) => !s().privateAreas.includes(a.name)).map((a) => a.name).join(", ")));
            return out.join("\n");
          },
        }),
      ],
      ingest: [
        {
          // OwnTracks HTTP mode (and anything speaking it). Points go to the database only.
          path: "/ingest/owntracks",
          scope: "location",
          maxBytes: 8192,
          async handle(body, ctx) {
            const items = (Array.isArray(body) ? body : [body]).slice(0, 100);
            let stored = 0;
            for (const raw of items) {
              const p = OwnTracks.safeParse(raw);
              if (!p.success || p.data._type !== "location" || p.data.lat === undefined || p.data.lon === undefined || p.data.tst === undefined) continue;
              await platform.db.run(`INSERT INTO location_points (t, lat, lon, acc, device) VALUES (?, ?, ?, ?, ?)`, [p.data.tst, p.data.lat, p.data.lon, p.data.acc ?? null, ctx.tokenId]);
              stored++;
            }
            return { stored };
          },
          // OwnTracks reads the reply as a list of messages for the app; an empty list means "nothing for you".
          reply: () => [],
        },
      ],
      jobs: [
        {
          id: "location-purge",
          everyMinutes: 24 * 60,
          run: async () => {
            const before = Math.floor(+platform.now() / 1000) - s().keepDays * 86400;
            await platform.db.run(`DELETE FROM location_points WHERE t < ?`, [before]);
          },
        },
      ],
    };
  },
});

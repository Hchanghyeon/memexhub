import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { pick, T, type Text } from "../../core/i18n.js";
import { addDays, localDate } from "../../core/time.js";
import type { WeatherDay, WeatherProvider } from "../../providers/weather/types.js";

/** WMO weather interpretation codes, grouped. */
const CODES: [number[], Text][] = [
  [[0], T("clear", "맑음")],
  [[1, 2], T("partly cloudy", "구름 조금")],
  [[3], T("overcast", "흐림")],
  [[45, 48], T("fog", "안개")],
  [[51, 53, 55, 56, 57], T("drizzle", "이슬비")],
  [[61, 63, 65, 66, 67, 80, 81, 82], T("rain", "비")],
  [[71, 73, 75, 77, 85, 86], T("snow", "눈")],
  [[95, 96, 99], T("thunderstorm", "뇌우")],
];
export const sky = (code: number, lang: "en" | "ko") => pick(CODES.find(([c]) => c.includes(code))?.[1] ?? T("unknown", "알 수 없음"), lang);
const deg = (n: number | null) => (n === null ? "?" : `${Math.round(n)}°`);

export function weatherLine(d: WeatherDay, lang: "en" | "ko") {
  const rain = d.rain && d.rain >= 0.1 ? (lang === "ko" ? ` · 강수 ${d.rain.toFixed(1)} mm` : ` · ${d.rain.toFixed(1)} mm`) : "";
  return lang === "ko" ? `${sky(d.code, lang)} · 최고 ${deg(d.max)} 최저 ${deg(d.min)}${rain}` : `${sky(d.code, lang)} · high ${deg(d.max)} low ${deg(d.min)}${rain}`;
}

export default defineModule({
  id: "weather",
  title: T("Weather", "날씨"),
  setup: async ({ provider, connections, settings, platform }) => {
    const names = await connections("weather");
    const lang = settings.toolLanguage === "ko" ? "ko" : "en";
    const tz = settings.timezone;
    const all = async () => (await Promise.all(names.map((n) => provider<WeatherProvider>("weather", n)))).filter((p): p is WeatherProvider => !!p);
    return {
      summary: {
        async day(date) {
          const out: string[] = [];
          for (const w of await all()) {
            const d = (await w.days(date, date))[0];
            if (d) out.push(`${w.place}: ${weatherLine(d, lang)}`);
          }
          return out.length ? out : undefined;
        },
      },
      tools: [
        defineTool({
          name: "weather_days",
          readOnly: true,
          description: T(
            "Daily weather (sky, high/low °C, precipitation) at the connected places, past or up to 15 days ahead. Default: today.",
            "연결한 장소의 날씨(하늘·최고/최저 기온·강수량), 지난 날이나 15일 뒤까지. 기본은 오늘.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(31).default(1) },
          async run({ date, days }) {
            const from = date ?? localDate(tz, platform.now());
            const to = addDays(from, days - 1);
            const ws = await all();
            if (!ws.length) return "no weather connection: admin UI → Connections → Open-Meteo";
            const out: string[] = [];
            for (const w of ws) {
              out.push(`${w.place}:`);
              for (const d of await w.days(from, to)) out.push(`- ${d.date} ${weatherLine(d, lang)}`);
            }
            return out.join("\n");
          },
        }),
      ],
    };
  },
});

import { z } from "zod";
import { defineModule, defineTool, type DayEvent, type ToolResult } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { b64 } from "../../core/crypto.js";
import { dayBounds, localDate, nowIn, zonedIso } from "../../core/time.js";
import type { Photo, PhotoSource } from "../../providers/photos/types.js";

const MAX_BYTES = 6_000_000; // all previews of one answer together

/** Keep the first of pictures taken within a few seconds of each other (bursts, retakes). */
export function dropBursts(list: Photo[], seconds = 3): Photo[] {
  const out: Photo[] = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind && Date.parse(p.takenAt) - Date.parse(last.takenAt) < seconds * 1000) continue;
    out.push(p);
  }
  return out;
}
/** At most n, spread evenly over the list. */
export const spread = <X>(list: X[], n: number) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]!));

const RULES = [
  "Look at each picture and file what it shows, then tell the owner in a few lines what you recorded:",
  "- food or drink they had → meal_add (time = the picture's time); ask about the portion when unsure",
  "- a receipt → compare with payments_day for that time; tell the owner the shop, total and items (do not record payments yourself)",
  "- a document, notes, a whiteboard, a book page → wiki_save_source with the text written out",
  "- a screenshot → one line on what it was (an article, a schedule …); never copy other people's messages",
  "- a place, an event, a view, something bought, a workout → one line for the day's journal",
  "- people: never identify faces or guess names; say who only when the calendar or the owner said so",
  "- never write out card, account or ID numbers, passwords or codes: write \"personal information, skipped\"",
  "- skip what is unclear; never invent what a picture does not show",
].join("\n");

export default defineModule({
  id: "photos",
  title: T("Photos", "사진"),
  setup: ({ settings, provider, platform }) => {
    const tz = () => settings.timezone;
    const source = () => provider<PhotoSource>("photos");
    const day = async (date: string) => {
      const s = await source();
      if (!s) return undefined;
      const [a, b] = dayBounds(tz(), date);
      return { s, list: await s.list(a, b) };
    };
    const hm = (iso: string) => {
      const p = nowIn(tz(), new Date(iso));
      return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
    };
    const counts = (list: Photo[], ko: boolean) => {
      const n = (k: Photo["kind"]) => list.filter((p) => p.kind === k).length;
      const parts = ko ? [["사진", n("photo")], ["스크린샷", n("screenshot")], ["동영상", n("video")]] : [["photos", n("photo")], ["screenshots", n("screenshot")], ["videos", n("video")]];
      return parts.filter(([, c]) => c).map(([l, c]) => `${l} ${c}`).join(" · ");
    };

    return {
      summary: {
        async day(date) {
          const d = await day(date);
          if (!d?.list.length) return undefined;
          const ko = settings.toolLanguage === "ko";
          return [`📷 ${counts(d.list, ko)}${ko ? " (photos_day 로 볼 수 있어요)" : " (photos_day shows them)"}`];
        },
        async events(date): Promise<DayEvent[]> {
          const d = await day(date);
          return (d?.list ?? []).filter((p) => p.kind !== "video").map((p) => ({ kind: "photo", start: Date.parse(p.takenAt), label: p.kind }));
        },
      },
      tools: [
        defineTool({
          name: "photos_day",
          readOnly: true,
          description: T(
            "Pictures the owner took on a day, as small previews you can look at, with their times. Narrow it with from/to (e.g. around a meal or a payment). Use it for the daily journal: food, receipts, documents, places. Previews are not stored anywhere.\n" + RULES,
            "주인이 그날 찍은 사진을 시각과 함께 작은 미리보기로 보여 준다. from/to 로 좁힌다 (끼니·결제 앞뒤 등). 하루 일지에 쓴다: 음식, 영수증, 문서, 장소. 미리보기는 어디에도 저장되지 않는다.\n" + RULES,
          ),
          input: {
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (default: today)"),
            from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM"),
            to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("HH:MM"),
            kinds: z.array(z.enum(["photo", "screenshot"])).optional().describe("Default: both"),
            limit: z.number().int().min(1).max(24).default(12),
          },
          async run(a): Promise<ToolResult | string> {
            const date = a.date ?? localDate(tz(), platform.now());
            const d = await day(date);
            if (!d) return "no photo connection (admin UI → Connections → Photos)";
            const at = (t: string) => Date.parse(zonedIso(tz(), Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), Number(t.slice(0, 2)), Number(t.slice(3, 5))));
            const lo = a.from ? at(a.from) : -Infinity;
            const hi = a.to ? at(a.to) + 60_000 : Infinity;
            const kinds = a.kinds ?? ["photo", "screenshot"];
            const inWindow = d.list.filter((p) => { const t = Date.parse(p.takenAt); return t >= lo && t < hi; });
            const pick = spread(dropBursts(inWindow.filter((p) => kinds.includes(p.kind as "photo" | "screenshot"))), a.limit ?? 12);
            const lines: string[] = [];
            const images: ToolResult["images"] = [];
            let bytes = 0;
            for (const p of pick) {
              const pv = await d.s.preview(p.id).catch(() => undefined);
              const fits = pv && bytes + pv.bytes.length <= MAX_BYTES;
              if (fits) {
                bytes += pv.bytes.length;
                images.push({ data: b64(pv.bytes), mimeType: pv.mimeType });
              }
              lines.push(`${fits ? `[${images.length}]` : "[-]"} ${hm(p.takenAt)} ${p.kind} ${p.name}${fits ? "" : " (no preview)"}`);
            }
            const head = `${date}${a.from || a.to ? ` ${a.from ?? "00:00"}–${a.to ?? "24:00"}` : ""}: ${inWindow.length} (${counts(inWindow, false) || "none"}), showing ${images.length}`;
            if (!pick.length) return `${head}\nno pictures in that window`;
            return { text: `${head}\n${RULES}\n\nPictures in order ([n] = the n-th image below):\n${lines.join("\n")}`, images };
          },
        }),
      ],
    };
  },
});

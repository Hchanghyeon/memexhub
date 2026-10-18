import type { DayEvent } from "../../core/registry.js";
import { nowIn } from "../../core/time.js";

/** Records of one moment merged: where you were, what you paid there, which calendar event it was. */
export interface Scene {
  kind: "stay" | "office" | "pay" | "move" | "meal";
  start: number;
  end: number;
  label: string;
  named?: boolean;
  online?: boolean;
  pays: DayEvent[];
  meals: DayEvent[];
  events: DayEvent[];
  taps: number;
  fromLocation: boolean;
}

const MIN = 60_000;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Merge a day's records into scenes, by time only (no coordinates here):
 * - stays are the frame; neighbouring stays with the same name become one;
 * - office gate taps make an office scene when no stay covers them;
 * - a payment joins the stay it falls in (±10 min), otherwise it is a scene of its own;
 * - a calendar event joins the scene that overlaps most with it, widened by an hour each side;
 *   appointments prefer places that are not registered everyday places (home, office);
 * - transit taps outside stays become "on the move" scenes.
 * Events that match nothing are returned as unmatched.
 */
export function buildScenes(all: DayEvent[]): { scenes: Scene[]; unmatched: DayEvent[] } {
  const by = (k: DayEvent["kind"]) => all.filter((e) => e.kind === k).sort((a, b) => a.start - b.start);
  const scene = (e: DayEvent, kind: Scene["kind"], fromLocation: boolean): Scene => ({ kind, start: e.start, end: e.end ?? e.start, label: e.label, named: e.named, online: e.online, pays: [], meals: [], events: [], taps: 0, fromLocation });

  const scenes: Scene[] = [];
  for (const s of by("stay")) {
    const last = scenes[scenes.length - 1];
    if (last && last.label === s.label && s.start - last.end <= 20 * MIN) last.end = Math.max(last.end, s.end ?? s.start);
    else scenes.push(scene(s, "stay", true));
  }
  for (const o of by("office")) {
    const end = o.end ?? o.start;
    if (!scenes.some((s) => overlap(s.start, s.end, o.start, end) > 0)) scenes.push(scene(o, "office", false));
  }
  const places = () => scenes.filter((s) => s.kind === "stay" || s.kind === "office");
  for (const p of by("pay")) {
    const at = !p.online && places().find((s) => p.start >= s.start - 10 * MIN && p.start <= s.end + 10 * MIN);
    if (at) at.pays.push(p);
    else scenes.push({ ...scene(p, "pay", false), pays: [p] });
  }
  // A meal joins the place it was eaten at (±30 min: logged times are rough), else stands alone.
  for (const m of by("meal")) {
    const at = places().find((s) => m.start >= s.start - 30 * MIN && m.start <= s.end + 30 * MIN);
    if (at) at.meals.push(m);
    else scenes.push({ ...scene(m, "meal", false), meals: [m] });
  }
  const unmatched: DayEvent[] = [];
  for (const ev of by("event")) {
    const w0 = ev.start - 60 * MIN;
    const w1 = (ev.end ?? ev.start + 60 * MIN) + 60 * MIN;
    const score = (s: Scene) => (s.online ? 0 : s.kind === "pay" ? (s.start >= w0 && s.start <= w1 ? MIN : 0) : overlap(s.start, s.end, w0, w1));
    const cands = scenes.filter((s) => score(s) > 0);
    const pool = cands.some((s) => !s.named) ? cands.filter((s) => !s.named) : cands;
    const best = pool.sort((a, b) => score(b) - score(a))[0];
    if (best) best.events.push(ev);
    else unmatched.push(ev);
  }
  // Transit taps outside every place, grouped while they are less than an hour apart.
  const inside = (t: number) => places().some((s) => t >= s.start - 5 * MIN && t <= s.end + 5 * MIN);
  let move: Scene | undefined;
  for (const t of by("transit").filter((x) => !inside(x.start))) {
    if (move && t.start - move.end <= 60 * MIN) {
      move.end = t.start;
      move.taps++;
    } else {
      move = { ...scene(t, "move", false), label: "", taps: 1 };
      scenes.push(move);
    }
  }
  return { scenes: scenes.sort((a, b) => a.start - b.start), unmatched };
}

const T = {
  ko: { move: (n: number) => `이동 (교통 ${n}번)`, noLoc: "체류로 안 잡힘", unmatched: "맞는 기록 없음", proof: "근거" },
  en: { move: (n: number) => `on the move (${n} taps)`, noLoc: "no stay", unmatched: "nothing matches", proof: "from" },
};

/** One line per scene, e.g. "18:47–20:44 📍 Hawolgok-dong · 💳 20:35 Koto ₩111,900 · 📅 18:00 Dinner (from 📍💳📅)". */
export function sceneLines(r: { scenes: Scene[]; unmatched: DayEvent[] }, tz: string, lang: "ko" | "en"): string[] {
  const t = T[lang];
  const hm = (ms: number) => {
    const p = nowIn(tz, new Date(ms));
    return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  };
  const span = (s: Scene) => (s.end - s.start >= MIN ? `${hm(s.start)}–${hm(s.end)}` : hm(s.start));
  const lines = r.scenes.map((s) => {
    const head =
      s.kind === "move" ? `🚇 ${t.move(s.taps)}`
      : s.kind === "office" ? `🏢 ${s.label}`
      : s.kind === "meal" ? `🍽 ${s.label} ${s.meals[0]?.amount ?? ""}`.trim()
      : s.kind === "pay" ? `${s.online ? "🌐" : "💳"} ${s.label} ${s.pays[0]?.amount ?? ""}`.trim() + (s.online ? "" : ` (${t.noLoc})`)
      : `📍 ${s.label}`;
    const extra = [
      ...(s.kind === "pay" ? [] : s.pays.map((p) => `💳 ${hm(p.start)} ${p.label} ${p.amount ?? ""}`.trim())),
      ...(s.kind === "meal" ? [] : s.meals.map((m) => `🍽 ${hm(m.start)} ${m.label} ${m.amount ?? ""}`.trim())),
      ...s.events.map((e) => `📅 ${hm(e.start)} ${e.label}`),
    ];
    const proof = [s.fromLocation ? "📍" : "", s.kind === "office" ? "🏢" : "", s.pays.length ? "💳" : "", s.meals.length ? "🍽" : "", s.events.length ? "📅" : ""].filter(Boolean);
    return `- ${span(s)} ${[head, ...extra].join(" · ")}${proof.length > 1 ? ` (${t.proof} ${proof.join("")})` : ""}`;
  });
  for (const e of r.unmatched) lines.push(`- 📅 ${t.unmatched}: ${hm(e.start)} ${e.label}`);
  return lines;
}

import { nowIn, zonedIso } from "../../core/time.js";

/** Health payloads → per-day updates. Shortcut format and Health Auto Export. Pure functions. */
export interface Sleep {
  start: string; // HH:MM
  end: string;
  asleep_min?: number;
  bed_min?: number;
  bed_only?: boolean;
  awake_n?: number;
  awake_min?: number;
  deep_min?: number;
  rem_min?: number;
  core_min?: number;
}
export interface Workout {
  type: string;
  start?: string;
  min?: number;
  kcal?: number;
}
export interface DayUpdate {
  metrics?: Record<string, number>;
  sleep?: Sleep;
  workouts?: Workout[];
}
export type Updates = Record<string, DayUpdate>; // YYYY-MM-DD → update

export const METRIC_KEYS = [
  "steps", "distance_km", "flights", "active_kcal", "exercise_min", "stand_hours", "resting_hr", "avg_hr", "walking_hr", "hrv",
  "spo2", "respiratory", "vo2max", "weight", "body_fat", "mindful_min", "water_ml", "caffeine_mg", "daylight_min", "headphone_db",
] as const;
const KNOWN = new Set<string>(METRIC_KEYS);
const SKIP = new Set(["date", "sleep", "workouts", "time", "sleep_start", "sleep_end", "sleep_value", "data"]);
const MAX_EXTRA = 20;
const KEY = /^[a-z][a-z0-9_]{0,29}$/;

/** '8,240' · '6.1 km' · 8240 → number; several lines → their sum. */
export function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return undefined;
  const s = String(v ?? "").trim().replace(/,/g, "");
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return undefined;
  return s.includes("\n") ? nums.reduce((a, b) => a + Number(b), 0) : Number(nums[0]);
}

/** Many date formats (ISO, '2026-10-14 00:40', iPhone '2026. 10. 14. 오전 12:40', '2026년 10월 14일 오후 1:05') → epoch ms. */
export function parseDt(v: unknown, tz: string): number | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(s) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const iso = s.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/);
  if (m) return Date.parse(zonedIso(tz, +m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0)));
  const k = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+?(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})/i);
  if (k) {
    let h = +k[5]!;
    const ap = (k[4] ?? "").toUpperCase();
    if ((ap === "오후" || ap === "PM") && h < 12) h += 12;
    if ((ap === "오전" || ap === "AM") && h === 12) h = 0;
    return Date.parse(zonedIso(tz, +k[1]!, +k[2]!, +k[3]!, h, +k[6]!));
  }
  return undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (t: number, tz: string) => {
  const p = nowIn(tz, new Date(t));
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
export const hmOf = (t: number, tz: string) => {
  const p = nowIn(tz, new Date(t));
  return `${pad(p.h)}:${pad(p.mi)}`;
};

/** '0:32:10' · '32:10' · '32분' · '1시간 5분' · '1920초' · 32 → minutes. */
export function minutes(v: unknown): number | undefined {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m) return +m[1]! * 60 + +m[2]! + +m[3]! / 60;
  m = s.match(/^(\d+):(\d{2})$/);
  if (m) return +m[1]! + +m[2]! / 60;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:시간|hr|h\b)/);
  const mi = s.match(/(\d+(?:\.\d+)?)\s*(?:분|min|m\b)/);
  const sec = s.match(/(\d+(?:\.\d+)?)\s*(?:초|sec|s\b)/);
  if (h || mi || sec) return (h ? +h[1]! * 60 : 0) + (mi ? +mi[1]! : 0) + (sec ? +sec[1]! / 60 : 0);
  return num(s);
}

type Kind = "bed" | "awake" | "deep" | "rem" | "core" | "asleep";
function kindOf(value: string): Kind {
  const v = (value ?? "").toLowerCase().replace(/\s/g, "");
  if (v.includes("침대") || v.includes("inbed")) return "bed";
  if (v.includes("깨어") || v.includes("awake")) return "awake";
  if (v.includes("깊은") || v.includes("deep")) return "deep";
  if (v.includes("렘") || v.includes("rem")) return "rem";
  if (v.includes("코어") || v.includes("core")) return "core";
  return "asleep";
}
type Iv = [number, number];
const union = (iv: Iv[]) => {
  const out: Iv[] = [];
  for (const [s, e] of [...iv].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};
const mins = (iv: Iv[]) => iv.reduce((a, [s, e]) => a + (e - s), 0) / 60_000;

/** Sleep samples 'start|end|value' per line → last night's sleep (the longest group) and the wake date. */
export function parseSleep(text: string, tz: string): (Sleep & { wake_date: string }) | undefined {
  const samples: [number, number, Kind][] = [];
  for (const line of String(text ?? "").split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const s = parseDt(parts[0], tz);
    const e = parseDt(parts[1], tz);
    if (s === undefined || e === undefined || e <= s || e - s > 16 * 3600_000) continue;
    samples.push([s, e, kindOf(parts[2] ?? "")]);
  }
  if (!samples.length) return undefined;
  samples.sort((a, b) => a[0] - b[0]);
  const groups: (typeof samples)[] = [];
  let cur: typeof samples = [];
  let curEnd = 0;
  for (const smp of samples) {
    if (cur.length && smp[0] - curEnd > 3 * 3600_000) {
      groups.push(cur);
      cur = [];
    }
    curEnd = cur.length ? Math.max(curEnd, smp[1]) : smp[1];
    cur.push(smp);
  }
  groups.push(cur);
  const night = groups.reduce((best, g) => (mins(union(g.map(([s, e]) => [s, e]))) > mins(union(best.map(([s, e]) => [s, e]))) ? g : best));
  const asleep = union(night.filter(([, , k]) => k !== "bed" && k !== "awake").map(([s, e]) => [s, e]));
  const bed = union(night.map(([s, e]) => [s, e]));
  const res: Sleep & { wake_date: string } = { wake_date: dayOf(Math.max(...night.map(([, e]) => e)), tz), start: "", end: "" };
  if (asleep.length) {
    const start = asleep[0]![0];
    const end = asleep[asleep.length - 1]![1];
    const gaps: Iv[] = asleep.slice(1).map((b, i) => [asleep[i]![1], b[0]]);
    const awake = union([...gaps, ...night.filter(([s, , k]) => k === "awake" && s >= start && s < end).map(([s, e]) => [s, e] as Iv)]).filter((iv) => mins([iv]) >= 5);
    Object.assign(res, { start: hmOf(start, tz), end: hmOf(end, tz), asleep_min: Math.round(mins(asleep)), awake_n: awake.length, awake_min: Math.round(mins(awake)) });
    for (const k of ["deep", "rem", "core"] as const) {
      const m = mins(union(night.filter(([, , kk]) => kk === k).map(([s, e]) => [s, e])));
      if (m) res[`${k}_min`] = Math.round(m);
    }
  } else Object.assign(res, { start: hmOf(bed[0]![0], tz), end: hmOf(bed[bed.length - 1]![1], tz), bed_min: Math.round(mins(bed)), bed_only: true });
  return res;
}

/** 'type|start|duration|kcal' per line. */
export function parseWorkouts(text: string, tz: string): Workout[] {
  const out: Workout[] = [];
  for (const line of String(text ?? "").split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (!parts[0]) continue;
    const w: Workout = { type: parts[0].replace(/\s+/g, " ").slice(0, 30) };
    const st = parts[1] ? parseDt(parts[1], tz) : undefined;
    if (st !== undefined) w.start = hmOf(st, tz);
    const m = parts[2] ? minutes(parts[2]) : undefined;
    if (m) w.min = Math.round(m);
    const k = parts[3] ? num(parts[3]) : undefined;
    if (k) w.kcal = Math.round(k);
    out.push(w);
  }
  return out.slice(0, 10);
}

/** iOS Shortcut payload: flat numbers + sleep + workouts. Activity belongs to `date` (default yesterday); sleep to its wake date. */
export function fromShortcut(p: Record<string, unknown>, tz: string, now: Date): Updates {
  let day = String(p.date ?? "").trim().slice(0, 10);
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const t = parseDt(`${p.date} 00:00`, tz);
    if (t === undefined) throw new Error("date must be YYYY-MM-DD");
    day = dayOf(t, tz);
  }
  if (!day) day = dayOf(+now - 86_400_000, tz);
  const metrics: Record<string, number> = {};
  let extra = 0;
  for (const [k, v] of Object.entries(p)) {
    if (SKIP.has(k) || !KEY.test(k)) continue;
    const n = num(v);
    if (n === undefined) continue;
    if (!KNOWN.has(k) && extra++ >= MAX_EXTRA) continue;
    metrics[k] = Math.round(n * 100) / 100;
  }
  let sleepText = typeof p.sleep === "string" ? p.sleep : "";
  if (!sleepText && p.sleep_start && p.sleep_end) {
    const lines = (v: unknown) => String(v ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    const ss = lines(p.sleep_start);
    const ee = lines(p.sleep_end);
    const vv = String(p.sleep_value ?? "").split("\n").map((x) => x.trim());
    sleepText = ss.slice(0, ee.length).map((a, i) => `${a}|${ee[i]}|${vv[i] ?? ""}`).join("\n");
  }
  const sleep = sleepText ? parseSleep(sleepText, tz) : undefined;
  const workouts = typeof p.workouts === "string" ? parseWorkouts(p.workouts, tz) : undefined;
  if (!Object.keys(metrics).length && !sleep && workouts === undefined) throw new Error("no health values (steps, sleep, workouts …)");
  const out: Updates = {};
  if (Object.keys(metrics).length || workouts !== undefined) out[day] = { metrics, ...(workouts !== undefined ? { workouts } : {}) };
  if (sleep) {
    const { wake_date, ...rest } = sleep;
    out[wake_date] = { ...(out[wake_date] ?? {}), sleep: rest };
  }
  return out;
}

/** Health Auto Export app: name → (our key, how several values a day combine). */
const HAE: Record<string, [string, "sum" | "avg"]> = {
  step_count: ["steps", "sum"], walking_running_distance: ["distance_km", "sum"], flights_climbed: ["flights", "sum"],
  active_energy: ["active_kcal", "sum"], apple_exercise_time: ["exercise_min", "sum"], apple_stand_hour: ["stand_hours", "sum"],
  resting_heart_rate: ["resting_hr", "avg"], heart_rate: ["avg_hr", "avg"], walking_heart_rate_average: ["walking_hr", "avg"],
  heart_rate_variability: ["hrv", "avg"], blood_oxygen_saturation: ["spo2", "avg"], respiratory_rate: ["respiratory", "avg"],
  vo2_max: ["vo2max", "avg"], weight_body_mass: ["weight", "avg"], body_fat_percentage: ["body_fat", "avg"],
  mindful_minutes: ["mindful_min", "sum"], dietary_water: ["water_ml", "sum"], dietary_caffeine: ["caffeine_mg", "sum"],
  time_in_daylight: ["daylight_min", "sum"], headphone_audio_exposure: ["headphone_db", "avg"],
};

function convert(key: string, units: string, v: number) {
  const u = (units ?? "").toLowerCase();
  if (key === "distance_km") return ["mi", "mile", "miles"].includes(u) ? v * 1.609344 : u === "m" ? v / 1000 : v;
  if (key === "active_kcal" && u === "kj") return v / 4.184;
  if (key === "weight" && ["lb", "lbs"].includes(u)) return v * 0.45359237;
  if (key === "water_ml" && u === "l") return v * 1000;
  if ((key === "spo2" || key === "body_fat") && v <= 1) return v * 100;
  if (key === "daylight_min" && ["hr", "h"].includes(u)) return v * 60;
  return v;
}

function haeSleep(entries: unknown[], tz: string): Record<string, Sleep> {
  const out: Record<string, Sleep> = {};
  const pieces: string[] = [];
  const total = (s: Sleep) => s.asleep_min ?? s.bed_min ?? 0;
  for (const e of entries as Record<string, any>[]) {
    if (!e || typeof e !== "object") continue;
    if ("sleepStart" in e || "totalSleep" in e || "inBedStart" in e) {
      const hrs = (k: string) => (Number(e[k]) || 0) * 60;
      const st = parseDt(e.sleepStart ?? e.inBedStart, tz);
      const en = parseDt(e.sleepEnd ?? e.inBedEnd, tz);
      if (st === undefined || en === undefined) continue;
      const asleep = hrs("totalSleep") || hrs("asleep") || hrs("core") + hrs("deep") + hrs("rem");
      const rec: Sleep = { start: hmOf(st, tz), end: hmOf(en, tz) };
      if (asleep) {
        rec.asleep_min = Math.round(asleep);
        for (const k of ["deep", "rem", "core", "awake"] as const) if (hrs(k)) rec[`${k}_min`] = Math.round(hrs(k));
      } else Object.assign(rec, { bed_min: Math.round(hrs("inBed") || (en - st) / 60_000), bed_only: true });
      const day = dayOf(en, tz);
      if (!out[day] || total(rec) > total(out[day]!)) out[day] = rec;
    } else if (e.startDate && e.endDate) {
      const st = parseDt(e.startDate, tz);
      const en = parseDt(e.endDate, tz);
      if (st !== undefined && en !== undefined) pieces.push(`${dayOf(st, tz)} ${hmOf(st, tz)}|${dayOf(en, tz)} ${hmOf(en, tz)}|${e.value ?? ""}`);
    }
  }
  const endDay = (p: string) => p.split("|")[1]!.slice(0, 10);
  for (const day of [...new Set(pieces.map(endDay))].sort()) {
    const prev = dayOf(Date.parse(`${day}T12:00:00Z`) - 86_400_000, "UTC");
    const lines = pieces.filter((p) => endDay(p) === day || (endDay(p) === prev && p.split("|")[1]!.slice(11) >= "18:00"));
    const sl = parseSleep(lines.join("\n"), tz);
    if (sl && sl.wake_date === day) {
      const { wake_date: _w, ...rest } = sl;
      out[day] = rest;
    }
  }
  return out;
}

export function fromHealthAutoExport(data: Record<string, any>, tz: string, now: Date): Updates {
  const sums: Record<string, Record<string, ["sum" | "avg", number[]]>> = {};
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  for (const m of metrics) {
    if (!m || typeof m !== "object" || m.name === "sleep_analysis") continue;
    const name = String(m.name ?? "");
    const known = HAE[name];
    const [key, how] = known ?? (KEY.test(name) ? [name, "avg" as const] : [undefined, undefined]);
    if (!key || !how) continue;
    for (const e of Array.isArray(m.data) ? m.data : []) {
      if (!e || typeof e !== "object") continue;
      const t = parseDt(e.date, tz);
      const n = num(e.qty ?? e.Avg ?? e.avg);
      if (t === undefined || n === undefined) continue;
      const slot = ((sums[dayOf(t, tz)] ??= {})[key] ??= [how, []]);
      slot[1].push(convert(key, String(m.units ?? ""), n));
    }
  }
  const out: Updates = {};
  for (const [d, ks] of Object.entries(sums)) {
    const mm: Record<string, number> = {};
    let extra = 0;
    for (const [k, [how, vals]] of Object.entries(ks)) {
      if (!KNOWN.has(k) && extra++ >= MAX_EXTRA) continue;
      mm[k] = Math.round((how === "sum" ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    }
    out[d] = { metrics: mm };
  }
  const sleepEntries = metrics.find((m: any) => m?.name === "sleep_analysis")?.data ?? [];
  for (const [d, sl] of Object.entries(haeSleep(Array.isArray(sleepEntries) ? sleepEntries : [], tz))) out[d] = { ...(out[d] ?? {}), sleep: sl };
  const wk: Record<string, Workout[]> = {};
  for (const w of Array.isArray(data.workouts) ? data.workouts : []) {
    if (!w || typeof w !== "object") continue;
    const st = parseDt(w.start, tz);
    if (st === undefined) continue;
    let dur = num(w.duration);
    if (dur && dur > 600) dur /= 60; // seconds
    const en = w.activeEnergyBurned ?? w.activeEnergy ?? {};
    let kcal = typeof en === "object" ? num(en.qty) : num(en);
    if (kcal && typeof en === "object" && String(en.units ?? "").toLowerCase() === "kj") kcal /= 4.184;
    const item: Workout = { type: String(w.name ?? "workout").slice(0, 30), start: hmOf(st, tz) };
    if (dur) item.min = Math.round(dur);
    if (kcal) item.kcal = Math.round(kcal);
    (wk[dayOf(st, tz)] ??= []).push(item);
  }
  for (const [d, items] of Object.entries(wk)) out[d] = { ...(out[d] ?? {}), workouts: items.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")).slice(0, 10) };
  const limit = dayOf(+now + 86_400_000, tz);
  for (const d of Object.keys(out)) if (d > limit) delete out[d]; // clock errors
  if (!Object.keys(out).length) throw new Error("no health values in the Health Auto Export body");
  return out;
}

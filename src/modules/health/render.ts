import type { DayUpdate, Sleep, Workout } from "./parse.js";

export interface DayRecord {
  metrics: Record<string, number>;
  sleep?: Sleep;
  workouts?: Workout[];
}

/** Later updates win per key; workouts and sleep are replaced as a whole. Re-sending a date replaces it. */
export function mergeDays(events: { date: string; update: DayUpdate }[]): Map<string, DayRecord> {
  const days = new Map<string, DayRecord>();
  for (const { date, update } of events) {
    const rec = days.get(date) ?? { metrics: {} };
    Object.assign(rec.metrics, update.metrics ?? {});
    if (update.workouts) rec.workouts = update.workouts;
    if (update.sleep) rec.sleep = update.sleep;
    days.set(date, rec);
  }
  return days;
}

type Lang = "ko" | "en";
const fmtInt = (n: number) => Number(fixed(n, 0)).toLocaleString("en-US");
/** Like Python's format(): exact halves round to even (70.25 → "70.2"), so notes match the reference output. */
const fixed = (n: number, d: number) => {
  const f = 10 ** d;
  const x = n * f;
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const r = Math.trunc(x) % 2 === 0 ? Math.trunc(x) : Math.trunc(x) + Math.sign(x);
    return (r / f).toFixed(d);
  }
  return n.toFixed(d);
};
const M: Record<string, { ko: string; en: string; f: (n: number, l: Lang) => string }> = {
  steps: { ko: "걸음", en: "steps", f: fmtInt },
  distance_km: { ko: "", en: "", f: (n) => `${fixed(n, 1)} km` },
  flights: { ko: "오른 층", en: "floors", f: (n) => fixed(n, 0) },
  active_kcal: { ko: "활동", en: "active", f: (n) => `${fmtInt(n)} kcal` },
  exercise_min: { ko: "운동", en: "exercise", f: (n, l) => (l === "ko" ? `${fixed(n, 0)}분` : `${fixed(n, 0)} min`) },
  stand_hours: { ko: "일어서기", en: "stand", f: (n, l) => (l === "ko" ? `${fixed(n, 0)}시간` : `${fixed(n, 0)} h`) },
  resting_hr: { ko: "안정 심박", en: "resting HR", f: (n) => fixed(n, 0) },
  avg_hr: { ko: "평균 심박", en: "avg HR", f: (n) => fixed(n, 0) },
  walking_hr: { ko: "걷기 심박", en: "walking HR", f: (n) => fixed(n, 0) },
  hrv: { ko: "HRV", en: "HRV", f: (n) => `${fixed(n, 0)} ms` },
  spo2: { ko: "산소", en: "SpO2", f: (n) => `${fixed(n, 0)}%` },
  respiratory: { ko: "호흡", en: "breaths", f: (n, l) => (l === "ko" ? `${fixed(n, 1)}회/분` : `${fixed(n, 1)}/min`) },
  vo2max: { ko: "VO2max", en: "VO2max", f: (n) => fixed(n, 1) },
  weight: { ko: "체중", en: "weight", f: (n) => `${fixed(n, 1)} kg` },
  body_fat: { ko: "체지방", en: "body fat", f: (n) => `${fixed(n, 1)}%` },
  mindful_min: { ko: "마음챙김", en: "mindful", f: (n, l) => (l === "ko" ? `${fixed(n, 0)}분` : `${fixed(n, 0)} min`) },
  water_ml: { ko: "물", en: "water", f: (n) => `${fmtInt(n)} ml` },
  caffeine_mg: { ko: "카페인", en: "caffeine", f: (n) => `${fixed(n, 0)} mg` },
  daylight_min: { ko: "햇빛", en: "daylight", f: (n, l) => (l === "ko" ? `${fixed(n, 0)}분` : `${fixed(n, 0)} min`) },
  headphone_db: { ko: "헤드폰", en: "headphones", f: (n) => `${fixed(n, 0)} dB` },
};
const dur = (m: number, l: Lang) => {
  const r = Math.round(m);
  if (l === "ko") return r >= 60 ? `${Math.floor(r / 60)}시간 ${r % 60}분` : `${r}분`;
  return r >= 60 ? `${Math.floor(r / 60)}h ${r % 60}m` : `${r} min`;
};

function sleepText(s: Sleep, l: Lang) {
  if (s.bed_only) return l === "ko" ? `😴 침대 ${s.start}–${s.end} (${dur(s.bed_min ?? 0, l)})` : `😴 in bed ${s.start}–${s.end} (${dur(s.bed_min ?? 0, l)})`;
  let t = `😴 ${s.start}–${s.end} · ${dur(s.asleep_min ?? 0, l)}`;
  const stages = ([["deep_min", l === "ko" ? "깊은" : "deep"], ["rem_min", l === "ko" ? "렘" : "REM"]] as const).filter(([k]) => s[k]).map(([k, n]) => `${n} ${dur(s[k]!, l)}`);
  if (stages.length) t += ` (${stages.join(" · ")})`;
  if (s.awake_n) t += l === "ko" ? ` · 깸 ${s.awake_n}번(${dur(s.awake_min ?? 0, l)})` : ` · awake ${s.awake_n}× (${dur(s.awake_min ?? 0, l)})`;
  else if (s.awake_min) t += l === "ko" ? ` · 깸 ${dur(s.awake_min, l)}` : ` · awake ${dur(s.awake_min, l)}`;
  return t;
}

const DOW = { ko: ["일", "월", "화", "수", "목", "금", "토"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };

export function dayLine(date: string, r: DayRecord, l: Lang) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const parts: string[] = [];
  if (r.sleep) parts.push(sleepText(r.sleep, l));
  for (const [k, def] of Object.entries(M)) if (k in r.metrics) parts.push((def[l] ? `${def[l]} ` : "") + def.f(r.metrics[k]!, l));
  for (const k of Object.keys(r.metrics).filter((k) => !(k in M)).sort()) parts.push(`${k} ${r.metrics[k]}`);
  for (const w of r.workouts ?? []) parts.push(`🏃 ${w.type}${w.min ? (l === "ko" ? ` ${w.min}분` : ` ${w.min} min`) : ""}${w.kcal ? ` ${w.kcal} kcal` : ""}`);
  return `- ${date.slice(5)} (${DOW[l][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}) ${parts.join(" · ") || (l === "ko" ? "기록 없음" : "no data")}`;
}

/** One year's health note, or one month's when `month` is given (note pattern with "{month}"). */
export function renderHealthNote(days: Map<string, DayRecord>, year: number, o: { lang: Lang; created: string; today: string }, month?: number) {
  const l = o.lang;
  const period = month === undefined ? `${year}` : `${year}-${String(month).padStart(2, "0")}`;
  const title = l === "ko" ? `${period} 건강 기록` : `${period} health`;
  const intro =
    l === "ko"
      ? ["폰의 건강 앱에서 매일 들어온 기록. 하루 한 줄.", "😴 는 그날 아침 깬 잠(지난밤). 워치 없이 폰만이면 '침대' 시간이다.", "걸음·운동 같은 활동은 그날 하루치 (보통 다음 날 아침에 들어온다).", "**이 노트는 엔진이 매번 다시 그린다: 손으로 고치면 다음 기록 때 사라진다.**"]
      : ["Daily records from the phone's health app, one line per day.", "😴 is the sleep you woke up from that morning. Without a watch it is time in bed.", "Activity (steps, exercise) is that day's total, usually sent the next morning.", "**The engine redraws this note on every record: hand edits are lost.**"];
  const out = [`---\ntitle: ${title}\ncreated: ${o.created}\nupdated: ${o.today}\ntype: note\ntags: []\n---\n`, `# ${title}\n`, intro.join("\n")];
  const dates = [...days.keys()].filter((d) => d.startsWith(`${period}-`)).sort();
  let section = "";
  for (const d of dates) {
    if (d.slice(0, 7) !== section) {
      section = d.slice(0, 7);
      out.push(`\n## ${section}\n`);
    }
    out.push(dayLine(d, days.get(d)!, l));
  }
  return out.join("\n") + "\n";
}

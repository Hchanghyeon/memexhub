import { zonedIso } from "../../core/time.js";
import { icalTime, type IcalEvent } from "./ical.js";

/*
 * Recurring events for plain iCalendar feeds (an "iCal link"), where nobody expands them for us.
 * Covers what calendar apps write in practice: FREQ DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL,
 * COUNT, UNTIL, BYDAY (weekdays, or "2MO" / "-1FR" in a month), BYMONTHDAY, BYMONTH, EXDATE, and moved
 * or cancelled single occurrences (RECURRENCE-ID). Times repeat on the event's own wall clock (TZID).
 */

const unfold = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MAX_STEPS = 20_000;

interface Prop { params: string; value: string }
interface Wall { y: number; m: number; d: number; h: number; mi: number }

/** Weekday 0 = Monday. */
const dow = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shift = (w: Wall, days: number): Wall => {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + days));
  return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const key = (w: Wall) => w.y * 10000 + w.m * 100 + w.d;

function parseWall(p: Prop): { wall: Wall; tz: string | "UTC" | null; allDay: boolean } | undefined {
  const m = p.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return undefined;
  const allDay = !m[4] || /VALUE=DATE(?!-)/i.test(p.params);
  const tz = m[7] ? "UTC" : p.params.match(/TZID=("?)([^";:]+)\1/i)?.[2] ?? null;
  return { wall: { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: allDay ? 0 : +m[4]!, mi: allDay ? 0 : +m[5]! }, tz, allDay };
}

function durationMs(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

interface Rule { freq: string; interval: number; count?: number; until?: number; byday: { n: number; day: number }[]; bymonthday: number[]; bymonth: number[] }
function parseRule(v: string, fallbackTz: string): Rule | undefined {
  const r = Object.fromEntries(v.split(";").map((x) => x.split("=") as [string, string]));
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(r.FREQ ?? "")) return undefined;
  const until = r.UNTIL ? icalTime(r.UNTIL.length === 8 ? ";VALUE=DATE" : "", r.UNTIL, fallbackTz) : undefined;
  return {
    freq: r.FREQ!,
    interval: Math.max(1, Number(r.INTERVAL ?? 1) || 1),
    ...(r.COUNT ? { count: Math.max(1, Number(r.COUNT) || 1) } : {}),
    // A date-only UNTIL includes that whole day.
    ...(until ? { until: until.allDay ? Date.parse(`${until.iso}T23:59:59Z`) + 14 * 3600_000 : Date.parse(until.iso) } : {}),
    byday: (r.BYDAY ?? "").split(",").filter(Boolean).map((x) => { const m = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/); return m ? { n: Number(m[1] ?? 0), day: DAYS.indexOf(m[2]!) } : undefined; }).filter((x): x is { n: number; day: number } => !!x),
    bymonthday: (r.BYMONTHDAY ?? "").split(",").filter(Boolean).map(Number).filter((n) => n && Math.abs(n) <= 31),
    bymonth: (r.BYMONTH ?? "").split(",").filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 12),
  };
}

/** Days of one month that match BYDAY with an ordinal ("2MO", "-1FR") or without (every Monday). */
function monthDays(y: number, m: number, rule: Rule, startDay: number): number[] {
  const n = daysIn(y, m);
  let out: number[];
  if (rule.byday.length) {
    out = [];
    for (const b of rule.byday) {
      const all = Array.from({ length: n }, (_, i) => i + 1).filter((d) => dow(y, m, d) === b.day);
      if (!b.n) out.push(...all);
      else { const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (d) out.push(d); }
    }
  } else if (rule.bymonthday.length) out = rule.bymonthday.map((d) => (d > 0 ? d : n + d + 1)).filter((d) => d >= 1 && d <= n);
  else out = startDay <= n ? [startDay] : [];
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Start walls of a rule, in order, from DTSTART (which always counts as the first one). */
function* occurrences(start: Wall, rule: Rule): Generator<Wall> {
  yield start;
  const sk = key(start);
  let steps = 0;
  if (rule.freq === "DAILY") {
    for (let w = shift(start, rule.interval); steps++ < MAX_STEPS; w = shift(w, rule.interval)) if (!rule.bymonth.length || rule.bymonth.includes(w.m)) yield w;
  } else if (rule.freq === "WEEKLY") {
    const days = (rule.byday.length ? rule.byday.map((b) => b.day) : [dow(start.y, start.m, start.d)]).sort((a, b) => a - b);
    const monday = shift(start, -dow(start.y, start.m, start.d));
    for (let wk = 0; steps++ < MAX_STEPS; wk += rule.interval)
      for (const d of days) { const w = shift(monday, wk * 7 + d); if (key(w) > sk) yield w; }
  } else {
    const years = rule.freq === "YEARLY";
    for (let i = 0; steps++ < MAX_STEPS; i += rule.interval) {
      const months = years ? (rule.bymonth.length ? rule.bymonth : [start.m]).map((m) => ({ y: start.y + i, m })) : [{ y: start.y + Math.floor((start.m - 1 + i) / 12), m: ((start.m - 1 + i) % 12) + 1 }];
      for (const { y, m } of months) for (const d of monthDays(y, m, rule, start.d)) { const w = { ...start, y, m, d }; if (key(w) > sk) yield w; }
    }
  }
}

/**
 * Every event occurrence that touches [from, to) (instants). One-off events pass through; recurring ones are
 * expanded; EXDATEs are skipped; an occurrence replaced by a RECURRENCE-ID event is shown as that event.
 */
export function expandIcal(text: string, fallbackTz: string, from: Date, to: Date): IcalEvent[] {
  const blocks = [...unfold(text).matchAll(/BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g)].map((b) => {
    const all: [string, Prop][] = [];
    for (const line of b[1]!.split("\n")) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i);
      if (m) all.push([m[1]!.toUpperCase(), { params: m[2]!, value: m[3]! }]);
    }
    const one = (k: string) => all.find(([n]) => n === k)?.[1];
    return { all, one };
  });
  const toIso = (w: Wall, tz: string | null, allDay: boolean) =>
    allDay ? `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`
    : tz === "UTC" ? new Date(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi)).toISOString()
    : new Date(zonedIso(validTz(tz) ? tz! : fallbackTz, w.y, w.m, w.d, w.h, w.mi)).toISOString();
  const ms = (iso: string, allDay: boolean) => (allDay ? Date.parse(`${iso}T00:00:00Z`) : Date.parse(iso));
  const lo = from.getTime() - 86400_000;
  const hi = to.getTime() + 86400_000;
  const touches = (s: number, e: number) => s < hi && e > lo;

  // Moved or cancelled single occurrences, by UID and the original start.
  const replaced = new Set<string>();
  for (const b of blocks) {
    const rid = b.one("RECURRENCE-ID");
    const uid = b.one("UID")?.value;
    if (!rid || !uid) continue;
    const p = parseWall(rid);
    if (p) replaced.add(`${uid}|${toIso(p.wall, p.tz, p.allDay)}`);
  }

  const out: IcalEvent[] = [];
  for (const b of blocks) {
    const st = b.one("DTSTART");
    const start = st && parseWall(st);
    if (!start) continue;
    const en = b.one("DTEND");
    const endP = en && parseWall(en);
    const startIso = toIso(start.wall, start.tz, start.allDay);
    const dur = endP ? ms(toIso(endP.wall, endP.tz, endP.allDay), endP.allDay) - ms(startIso, start.allDay) : b.one("DURATION") ? durationMs(b.one("DURATION")!.value) : start.allDay ? 86400_000 : 0;
    const loc = b.one("LOCATION")?.value;
    const base = {
      title: unescape(b.one("SUMMARY")?.value ?? "") || "(no title)",
      allDay: start.allDay,
      ...(loc && unescape(loc) ? { location: unescape(loc) } : {}),
      cancelled: (b.one("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
    };
    const emit = (iso: string) => {
      const s = ms(iso, start.allDay);
      if (!touches(s, s + Math.max(dur, 1))) return;
      const end = dur > 0 ? (start.allDay ? new Date(s + dur).toISOString().slice(0, 10) : new Date(s + dur).toISOString()) : undefined;
      out.push({ ...base, start: iso, ...(end ? { end } : {}) });
    };
    const rr = b.one("RRULE");
    const rule = rr && !b.one("RECURRENCE-ID") ? parseRule(rr.value, fallbackTz) : undefined;
    if (!rule) {
      emit(startIso);
      continue;
    }
    const uid = b.one("UID")?.value ?? "";
    const ex = new Set<string>();
    for (const [n, p] of b.all) if (n === "EXDATE") for (const v of p.value.split(",")) { const w = parseWall({ params: p.params, value: v.trim() }); if (w) ex.add(toIso(w.wall, w.tz ?? start.tz, w.allDay || start.allDay)); }
    let n = 0;
    for (const w of occurrences(start.wall, rule)) {
      const iso = toIso(w, start.tz, start.allDay);
      const at = ms(iso, start.allDay);
      if ((rule.until !== undefined && at > rule.until) || at > hi) break;
      if (rule.count !== undefined && ++n > rule.count) break;
      if (ex.has(iso) || replaced.has(`${uid}|${iso}`)) continue;
      emit(iso);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function validTz(tz: string | null): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The feed's own name (X-WR-CALNAME), if it has one. */
export const feedName = (text: string) => unescape(unfold(text).match(/^X-WR-CALNAME:(.*)$/m)?.[1] ?? "") || undefined;

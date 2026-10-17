/** Time-zone helpers on Intl only (portable). */
function parts(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year!, m: +o.month!, d: +o.day!, h: +o.hour!, mi: +o.minute!, s: +o.second! };
}

/** Offset of `tz` at instant `d`, as "+09:00". */
export function offsetOf(tz: string, d: Date): string {
  const p = parts(tz, d);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const mins = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = mins >= 0 ? "+" : "-";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** Wall-clock time in `tz` → ISO string with that zone's offset. */
export function zonedIso(tz: string, y: number, mo: number, d: number, h: number, mi: number): string {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = offsetOf(tz, guess);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00${off}`;
}

export function nowIn(tz: string, d = new Date()) {
  return parts(tz, d);
}

/** "YYYY-MM-DD" ± n days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export const weekdayMon0 = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/** [start, end) of a local calendar day as instants. */
export function dayBounds(tz: string, date: string): [Date, Date] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = addDays(date, 1).split("-").map(Number) as [number, number, number];
  return [new Date(zonedIso(tz, y, m, d, 0, 0)), new Date(zonedIso(tz, y2, m2, d2, 0, 0))];
}

/** Local date of an instant. */
export function localDate(tz: string, t: Date): string {
  const p = nowIn(tz, t);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * A note path pattern filled for a period: "{year}" and "{month}" (01–12).
 * A pattern with "{month}" makes one note per month (smaller notes, cheaper for routines to read).
 */
export const perMonth = (pattern: string) => pattern.includes("{month}");
export function periodPath(pattern: string, y: number, m: number): string {
  return pattern.replaceAll("{year}", String(y)).replaceAll("{month}", String(m).padStart(2, "0"));
}

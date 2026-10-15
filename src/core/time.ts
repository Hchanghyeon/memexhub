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

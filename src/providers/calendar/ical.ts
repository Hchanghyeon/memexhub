import { zonedIso } from "../../core/time.js";

/** Minimal iCalendar (RFC 5545) reader for VEVENTs: what a day summary needs, nothing more. */
export interface IcalEvent {
  title: string;
  start: string; // ISO instant, or YYYY-MM-DD when all-day
  end?: string;
  allDay: boolean;
  location?: string;
  cancelled: boolean;
}

const unfold = (s: string) => s.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** DTSTART/DTEND value → ISO. Floating times and unknown TZIDs use `fallbackTz`. */
export function icalTime(params: string, value: string, fallbackTz: string): { iso: string; allDay: boolean } | undefined {
  const d = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d || /VALUE=DATE(?!-)/i.test(params)) {
    const m = d ?? value.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true } : undefined;
  }
  const t = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!t) return undefined;
  const [, y, mo, da, h, mi, , z] = t;
  if (z) return { iso: new Date(Date.UTC(+y!, +mo! - 1, +da!, +h!, +mi!)).toISOString(), allDay: false };
  const tzid = params.match(/TZID=("?)([^";:]+)\1/i)?.[2];
  const tz = tzid && validTz(tzid) ? tzid : fallbackTz;
  return { iso: new Date(zonedIso(tz, +y!, +mo!, +da!, +h!, +mi!)).toISOString(), allDay: false };
}

export function parseIcal(text: string, fallbackTz: string): IcalEvent[] {
  const out: IcalEvent[] = [];
  for (const block of unfold(text).matchAll(/BEGIN:VEVENT\n([\s\S]*?)END:VEVENT/g)) {
    const props = new Map<string, { params: string; value: string }>();
    for (const line of block[1]!.split("\n")) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i);
      if (m && !props.has(m[1]!.toUpperCase())) props.set(m[1]!.toUpperCase(), { params: m[2]!, value: m[3]! });
    }
    const st = props.get("DTSTART");
    const start = st && icalTime(st.params, st.value, fallbackTz);
    if (!start) continue;
    const en = props.get("DTEND");
    const end = en && icalTime(en.params, en.value, fallbackTz);
    const loc = props.get("LOCATION")?.value;
    out.push({
      title: unescape(props.get("SUMMARY")?.value ?? "") || "(no title)",
      start: start.iso,
      ...(end ? { end: end.iso } : {}),
      allDay: start.allDay,
      ...(loc && unescape(loc) ? { location: unescape(loc) } : {}),
      cancelled: (props.get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
    });
  }
  return out;
}

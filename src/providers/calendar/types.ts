export interface CalendarInfo {
  id: string;
  name: string;
}
/** One occurrence (recurring events are expanded). `start`/`end` are ISO instants, or YYYY-MM-DD when all-day. */
export interface CalendarEvent {
  calendar: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
}

/** A calendar account, read-only. Dates are local calendar days (inclusive) in the hub time zone. */
export interface CalendarProvider {
  calendars(): Promise<CalendarInfo[]>;
  events(from: string, to: string): Promise<CalendarEvent[]>;
}

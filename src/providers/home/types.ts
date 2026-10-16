export interface EntityState {
  entity: string; // light.desk
  name: string; // friendly name
  state: string;
  changed: string; // ISO
}
export interface LogEntry {
  when: string; // ISO
  entity?: string;
  name: string;
  message: string;
}

/** A smart-home hub, read-only. */
export interface HomeProvider {
  /** Entities the admin picked for the daily summary. */
  summaryEntities: string[];
  states(): Promise<EntityState[]>;
  logbook(from: Date, to: Date, entity?: string): Promise<LogEntry[]>;
}

import type { Db } from "../platform/types.js";
import { randomToken } from "./crypto.js";

export interface LifeEvent {
  id: string;
  type: string; // "payment" | "transit" | "office" | "health" | "merge" ...
  occurredAt: string; // ISO with offset
  receivedAt: string;
  source: string;
  payload: Record<string, unknown>;
  skipped?: string | null;
}

type Listener = (e: LifeEvent) => Promise<void> | void;

/**
 * Append-only event log (repository) + in-process observer.
 * Modules append raw facts; renderers subscribe and redraw notes.
 */
export class EventBus {
  private listeners = new Map<string, Listener[]>();
  constructor(private db: Db) {}

  /** Drop all listeners — called before modules are reloaded so listeners never pile up. */
  reset() {
    this.listeners.clear();
  }

  on(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  async append(e: Omit<LifeEvent, "id" | "receivedAt"> & { id?: string }): Promise<LifeEvent> {
    const full: LifeEvent = { ...e, id: e.id ?? randomToken("ev_").slice(0, 27), receivedAt: new Date().toISOString() };
    await this.db.run(
      `INSERT INTO events (id, type, occurred_at, received_at, source, payload, skipped) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [full.id, full.type, full.occurredAt, full.receivedAt, full.source, JSON.stringify(full.payload), full.skipped ?? null],
    );
    // Listeners see every event (including skipped ones such as merges) and decide what matters.
    for (const fn of this.listeners.get(full.type) ?? []) await fn(full);
    return full;
  }

  /**
   * Bulk import: one atomic insert, then listeners hear one event per (type, year) instead of every row —
   * renderers redraw whole years, so a 10,000-row import redraws each note once.
   */
  async appendMany(list: (Omit<LifeEvent, "id" | "receivedAt"> & { id?: string })[]): Promise<number> {
    const now = new Date().toISOString();
    const full = list.map((e) => ({ ...e, id: e.id ?? randomToken("ev_").slice(0, 27), receivedAt: now }) as LifeEvent);
    for (let i = 0; i < full.length; i += 500)
      await this.db.batch(full.slice(i, i + 500).map((f) => ({
        sql: `INSERT INTO events (id, type, occurred_at, received_at, source, payload, skipped) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [f.id, f.type, f.occurredAt, f.receivedAt, f.source, JSON.stringify(f.payload), f.skipped ?? null],
      })));
    const seen = new Map<string, LifeEvent>();
    for (const f of full) seen.set(`${f.type}|${f.occurredAt.slice(0, 4)}`, f);
    for (const f of seen.values()) for (const fn of this.listeners.get(f.type) ?? []) await fn(f);
    return full.length;
  }

  async query(types: string[], opts: { from?: string; to?: string; includeSkipped?: boolean } = {}): Promise<LifeEvent[]> {
    const where = [`type IN (${types.map(() => "?").join(",")})`];
    const params: unknown[] = [...types];
    if (opts.from) (where.push("occurred_at >= ?"), params.push(opts.from));
    if (opts.to) (where.push("occurred_at < ?"), params.push(opts.to));
    if (!opts.includeSkipped) where.push("skipped IS NULL");
    const rows = await this.db.all<any>(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY occurred_at`, params);
    return rows.map((r) => ({
      id: r.id, type: r.type, occurredAt: r.occurred_at, receivedAt: r.received_at,
      source: r.source, payload: JSON.parse(r.payload), skipped: r.skipped,
    }));
  }
}

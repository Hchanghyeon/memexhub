import type { Db } from "../platform/types.js";

/** Small JSON state per key (e.g. which mails a job already read). */
export class Cursors {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}
  async get<T>(key: string): Promise<T | undefined> {
    const r = await this.db.get<{ value: string }>(`SELECT value FROM cursors WHERE key = ?`, [key]);
    return r ? (JSON.parse(r.value) as T) : undefined;
  }
  async set(key: string, value: unknown) {
    await this.db.run(
      `INSERT INTO cursors (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), this.now().toISOString()],
    );
  }
}

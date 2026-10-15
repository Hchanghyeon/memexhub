import type { Db } from "../platform/types.js";
import { decrypt, encrypt, randomToken } from "./crypto.js";

export interface InboxItem<T = unknown> {
  id: string;
  module: string;
  channel: string;
  receivedAt: string;
  reason: string;
  status: "pending" | "resolved" | "ignored";
  data?: T; // decrypted; undefined once resolved
}

const PURPOSE = "inbox";

/**
 * Messages a module could not read, kept for Claude or the admin to decide.
 * The content (message + guess) is encrypted with its own key purpose and bound to the item id;
 * it is wiped when the item is resolved and the row is deleted after `days`.
 */
export class Inbox {
  constructor(
    private db: Db,
    private secret: string,
    private now: () => Date = () => new Date(),
  ) {}

  async add<T>(module: string, channel: string, reason: string, data: T): Promise<string> {
    const id = randomToken("ib_").slice(0, 14);
    const blob = await encrypt(this.secret, PURPOSE, JSON.stringify(data), id);
    await this.db.run(`INSERT INTO inbox (id, module, channel, received_at, reason, blob) VALUES (?, ?, ?, ?, ?, ?)`, [
      id, module, channel, this.now().toISOString(), reason.slice(0, 300), blob,
    ]);
    return id;
  }

  private async row<T>(r: any): Promise<InboxItem<T>> {
    let data: T | undefined;
    if (r.blob) data = JSON.parse(await decrypt(this.secret, PURPOSE, r.blob, r.id)) as T;
    return { id: r.id, module: r.module, channel: r.channel, receivedAt: r.received_at, reason: r.reason, status: r.status, data };
  }

  async list<T>(module: string, opts: { status?: InboxItem["status"]; limit?: number } = {}): Promise<InboxItem<T>[]> {
    const rows = await this.db.all<any>(`SELECT * FROM inbox WHERE module = ? AND status = ? ORDER BY received_at LIMIT ?`, [
      module, opts.status ?? "pending", Math.min(opts.limit ?? 50, 200),
    ]);
    return Promise.all(rows.map((r) => this.row<T>(r)));
  }

  async count(module: string): Promise<number> {
    return (await this.db.get<{ n: number }>(`SELECT COUNT(*) n FROM inbox WHERE module = ? AND status = 'pending'`, [module]))?.n ?? 0;
  }

  async get<T>(module: string, id: string): Promise<InboxItem<T> | undefined> {
    const r = await this.db.get<any>(`SELECT * FROM inbox WHERE module = ? AND id = ?`, [module, id]);
    return r ? this.row<T>(r) : undefined;
  }

  /** Mark done and wipe the content. */
  async close(module: string, id: string, status: "resolved" | "ignored") {
    await this.db.run(`UPDATE inbox SET status = ?, resolved_at = ?, blob = NULL WHERE module = ? AND id = ? AND status = 'pending'`, [
      status, this.now().toISOString(), module, id,
    ]);
  }

  /** Delete items older than `days` (pending or not). Returns how many were deleted. */
  async purge(module: string, days: number): Promise<number> {
    const before = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const n = (await this.db.get<{ n: number }>(`SELECT COUNT(*) n FROM inbox WHERE module = ? AND received_at < ?`, [module, before]))?.n ?? 0;
    await this.db.run(`DELETE FROM inbox WHERE module = ? AND received_at < ?`, [module, before]);
    return n;
  }
}

/** Mask digit runs of 8+ (account / card numbers) before content is shown to Claude. */
export const maskLongDigits = (s: string) => s.replace(/\d(?:[\d\- ]{6,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? m.replace(/\d/g, "•") : m));

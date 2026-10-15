import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import type { Db, Logger, Platform } from "./types.js";
import { inAny, PRIVATE_CIDRS } from "../core/ip.js";

export function sqliteDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return {
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...(params as any[]));
      return { changes: r.changes };
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...(params as any[])) as any;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...(params as any[])) as any;
    },
    async batch(statements) {
      db.transaction(() => {
        for (const s of statements) db.prepare(s.sql).run(...((s.params ?? []) as any[]));
      })();
    },
    async close() {
      db.close();
    },
  };
}

/** Structured JSON logs. Callers must not pass personal data (amounts, merchants, coordinates, mail content). */
export const jsonLogger: Logger = {
  info: (msg, f) => console.log(JSON.stringify({ level: "info", msg, ...f, t: new Date().toISOString() })),
  warn: (msg, f) => console.warn(JSON.stringify({ level: "warn", msg, ...f, t: new Date().toISOString() })),
  error: (msg, f) => console.error(JSON.stringify({ level: "error", msg, ...f, t: new Date().toISOString() })),
};

export function nodePlatform(opts: { dataDir: string; secret: string; dbFile?: string; log?: Logger }): Platform {
  mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(opts.dataDir, 0o700);
  } catch {
    /* not owner — ignore */
  }
  const file = opts.dbFile ?? join(opts.dataDir, "memexhub.db");
  const db = sqliteDb(file);
  try {
    if (file !== ":memory:") chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return {
    name: "node",
    db,
    secret: opts.secret,
    now: () => new Date(),
    fetch: globalThis.fetch.bind(globalThis),
    log: opts.log ?? jsonLogger,
    async isPrivateHost(host) {
      try {
        const addrs = await lookup(host, { all: true });
        return addrs.some((a) => inAny(a.address, [...PRIVATE_CIDRS, "0.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10"]));
      } catch {
        return true; // fail closed
      }
    },
  };
}

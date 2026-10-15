import type { Db, Logger, Platform } from "./types.js";

/** The parts of Cloudflare's D1 API we use (declared here so no Workers type package is needed). */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<{ meta?: { changes?: number } }>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

/** D1 behind the Db interface. D1 is SQLite, so the same migrations and queries run unchanged. */
export function d1Db(d1: D1Like): Db {
  const st = (sql: string, params: unknown[] = []) => d1.prepare(sql).bind(...params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p)));
  return {
    async run(sql, params) {
      const r = await st(sql, params).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    async get<T>(sql: string, params?: unknown[]) {
      return ((await st(sql, params).first<T>()) ?? undefined) as T | undefined;
    },
    async all<T>(sql: string, params?: unknown[]) {
      return ((await st(sql, params).all<T>()).results ?? []) as T[];
    },
    async batch(statements) {
      if (statements.length) await d1.batch(statements.map((s) => st(s.sql, s.params)));
    },
    async close() {},
  };
}

const consoleLogger: Logger = {
  info: (msg, f) => console.log(JSON.stringify({ level: "info", msg, ...f })),
  warn: (msg, f) => console.warn(JSON.stringify({ level: "warn", msg, ...f })),
  error: (msg, f) => console.error(JSON.stringify({ level: "error", msg, ...f })),
};

/**
 * Cloudflare Workers runtime. There is no disk (no automatic backup files — download them in the admin UI)
 * and no private network (outbound requests to private addresses are impossible anyway).
 */
export function workersPlatform(env: { MEMEXHUB_SECRET: string; DB: D1Like } & Record<string, unknown>): Platform {
  return {
    name: "workers",
    db: d1Db(env.DB),
    secret: env.MEMEXHUB_SECRET,
    now: () => new Date(),
    fetch: (input, init) => fetch(input, init),
    log: consoleLogger,
    bindings: env,
  };
}

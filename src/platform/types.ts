/**
 * Everything that differs between runtimes (Node, Cloudflare Workers) lives behind this interface.
 * `src/core`, `src/modules` and `src/auth` must only use runtime features through a Platform.
 */
export interface Db {
  /** Execute a statement that returns no rows. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** First row or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** All rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run several statements atomically. */
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  close(): Promise<void>;
}

export interface Platform {
  name: "node" | "workers";
  db: Db;
  /** Raw secret material (MEMEXHUB_SECRET). Never log it. */
  secret: string;
  /** Wall clock — injectable for tests. */
  now(): Date;
  /** Outbound HTTP. Providers must use this so the SSRF guard applies. */
  fetch: typeof fetch;
  log: Logger;
  /** Does this host name resolve to a private / loopback / link-local address? (SSRF guard). Optional on runtimes that can't reach private networks. */
  isPrivateHost?(host: string): Promise<boolean>;
  /** Runtime resources by name (Workers bindings such as an R2 bucket). */
  bindings?: Record<string, unknown>;
  /** Where automatic backups are kept (Node: DATA_DIR/backups). Optional on runtimes without a disk. */
  backups?: BackupStore;
}

export interface BackupStore {
  save(name: string, data: string): Promise<void>;
  list(): Promise<{ name: string; size: number; created: Date }[]>;
  read(name: string): Promise<string>;
  /** Keep the newest `keep` files. */
  prune(keep: number): Promise<void>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

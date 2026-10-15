export interface FileInfo {
  path: string; // vault-relative, forward slashes
  size: number;
  mtime: Date;
  etag?: string;
}

export class StorageError extends Error {
  constructor(
    public code: "not_found" | "exists" | "conflict" | "forbidden" | "invalid" | "io",
    message: string,
  ) {
    super(message);
  }
}

/**
 * A place where the vault lives. Implementations must be dumb: no path policy, no audit.
 * Policy (allowed paths, protected paths, trash, size limits) is enforced once in SafeVault.
 */
export interface VaultStorage {
  readonly id: string; // "fs" | "webdav" | "s3" ...
  read(path: string): Promise<{ text: string; etag?: string }>;
  /** ifMatch: fail with "conflict" if the current etag differs (when supported). ifNoneMatch "*": fail if exists. */
  write(path: string, text: string, opts?: { ifMatch?: string; ifNoneMatch?: "*" }): Promise<{ etag?: string }>;
  list(dir?: string): Promise<FileInfo[]>; // recursive
  stat(path: string): Promise<FileInfo | null>;
  move(from: string, to: string): Promise<void>; // must fail with "exists" if `to` exists
  capabilities: { search?: boolean; etag?: boolean };
  search?(query: RegExp, opts: { limit: number }): Promise<{ path: string; lines: { n: number; text: string }[] }[]>;
}

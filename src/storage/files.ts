/** Byte-level access to a vault the server holds itself (built-in or local folder), for the built-in WebDAV. */
export interface RawEntry {
  path: string; // vault-relative, "" = root
  dir: boolean;
  size: number;
  mtime: Date;
  etag?: string;
}

export interface RawFiles {
  stat(path: string): Promise<RawEntry | null>;
  children(dir: string): Promise<RawEntry[]>;
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
  write(path: string, data: Uint8Array, o?: { ifMatch?: string; ifNoneMatch?: boolean }): Promise<RawEntry>;
  mkdir(path: string): Promise<void>;
  /** Move to `.trash/<stamp>/<path>` — never a real delete. */
  trash(path: string): Promise<void>;
  move(from: string, to: string, overwrite: boolean): Promise<void>;
}

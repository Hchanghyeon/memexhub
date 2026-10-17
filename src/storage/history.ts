/**
 * Change history of a vault (design: vault note "설계 9 - 볼트 변경 이력"). Runtime-neutral interface;
 * the Node platform implements it with git, kept outside the vault folder. Optional: no history on Workers.
 */
export interface HistoryEntry {
  rev: string;
  date: string; // ISO
  message: string;
}

export interface VaultHistory {
  /** Record these paths if they changed (also deletions). */
  record(paths: string[], message: string): Promise<void>;
  /** Record every change in the vault (outside edits). Returns how many files changed. */
  recordAll(message: string): Promise<number>;
  log(path: string, limit: number): Promise<HistoryEntry[]>;
  /** A note's text at a revision. */
  show(path: string, rev: string): Promise<string>;
  stats(): Promise<{ commits: number }>;
}

export const REV = /^[0-9a-f]{7,40}$/;

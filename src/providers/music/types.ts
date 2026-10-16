/** One played track. */
export interface Play {
  at: string; // ISO instant it was played (started or scrobbled)
  title: string;
  artist: string;
  album?: string;
}

/** A listening history service, read-only. */
export interface MusicProvider {
  /**
   * Plays in [from, to), newest first. `history` = the service keeps a long history (Last.fm); otherwise only the
   * most recent plays are available (Spotify: 50) and memexhub collects them over time.
   */
  readonly history: boolean;
  plays(from: Date, to: Date): Promise<Play[]>;
}

export interface MailSummary {
  uid: string;
  folder: string;
  date: string; // "YYYY-MM-DD HH:MM" in the configured time zone
  from: string;
  subject: string;
}

export interface Mail extends MailSummary {
  to: string;
  text: string; // plain text, links replaced, capped
  attachments: string[]; // names only — never opened
  truncated: boolean;
}

/** Read-only mail access. There is deliberately no send, move, delete or flag operation. */
export interface MailProvider {
  folders(): Promise<string[]>;
  search(q: { folder: string; since: string; until?: string; query?: string; from?: string; limit: number }): Promise<MailSummary[]>;
  read(folder: string, uid: string): Promise<Mail>;
  /** Folders for the daily digest: [folder, label, include body preview] */
  digestFolders(): [string, string, boolean][];
}

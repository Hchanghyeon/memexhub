import type { Db } from "../platform/types.js";
import { decrypt, encrypt, randomToken } from "./crypto.js";
import { audit } from "./audit.js";

export interface Connection {
  id: string;
  kind: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

/** Repository for provider connections. Secrets are AES-GCM encrypted with the connection id as AAD and are write-only. */
export class Connections {
  constructor(private db: Db, private secret: string) {}

  async upsert(c: { kind: string; provider: string; name: string; config: Record<string, unknown>; secrets?: Record<string, string> }, actor: string) {
    const existing = await this.db.get<{ id: string }>(`SELECT id FROM connections WHERE kind = ? AND name = ?`, [c.kind, c.name]);
    const id = existing?.id ?? randomToken("con_").slice(0, 20);
    const enc = c.secrets && Object.keys(c.secrets).length ? await encrypt(this.secret, "connections", JSON.stringify(c.secrets), id) : null;
    if (existing) {
      await this.db.run(
        `UPDATE connections SET provider = ?, config = ?, secrets_enc = COALESCE(?, secrets_enc), enabled = 1 WHERE id = ?`,
        [c.provider, JSON.stringify(c.config), enc, id],
      );
    } else {
      await this.db.run(
        `INSERT INTO connections (id, kind, provider, name, config, secrets_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, c.kind, c.provider, c.name, JSON.stringify(c.config), enc, new Date().toISOString()],
      );
    }
    await audit(this.db, actor, existing ? "connection.update" : "connection.create", id, { kind: c.kind, provider: c.provider, name: c.name });
    return id;
  }

  async byId(id: string): Promise<Connection | undefined> {
    return (await this.list()).find((c) => c.id === id);
  }

  /** Merge into an existing connection's config and (encrypted) secrets, e.g. after an OAuth sign-in. */
  async patch(id: string, p: { config?: Record<string, unknown>; secrets?: Record<string, string> }, actor: string) {
    const c = await this.byId(id);
    if (!c) throw new Error("no such connection");
    const secrets = p.secrets ? { ...(await this.secretsOf(id)), ...p.secrets } : undefined;
    await this.upsert({ kind: c.kind, provider: c.provider, name: c.name, config: { ...c.config, ...(p.config ?? {}) }, secrets }, actor);
  }

  async list(kind?: string): Promise<Connection[]> {
    const rows = await this.db.all<any>(kind ? `SELECT * FROM connections WHERE kind = ?` : `SELECT * FROM connections`, kind ? [kind] : []);
    return rows.map((r) => ({ id: r.id, kind: r.kind, provider: r.provider, name: r.name, config: JSON.parse(r.config), enabled: !!r.enabled }));
  }

  async get(kind: string, name: string) {
    return (await this.list(kind)).find((c) => c.name === name);
  }

  /** Only providers call this, inside the server. Never expose through a tool or API. */
  async secretsOf(id: string): Promise<Record<string, string>> {
    const row = await this.db.get<{ secrets_enc: string | null }>(`SELECT secrets_enc FROM connections WHERE id = ?`, [id]);
    return row?.secrets_enc ? JSON.parse(await decrypt(this.secret, "connections", row.secrets_enc, id)) : {};
  }

  async setStatus(id: string, ok: boolean, error?: string) {
    await this.db.run(
      ok ? `UPDATE connections SET status = 'ok', last_ok_at = ?, last_error = NULL WHERE id = ?` : `UPDATE connections SET status = 'error', last_error = ? WHERE id = ?`,
      ok ? [new Date().toISOString(), id] : [String(error ?? "").slice(0, 200), id],
    );
  }
}

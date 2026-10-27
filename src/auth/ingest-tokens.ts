import type { Db } from "../platform/types.js";
import { randomToken, sha256Hex } from "../core/crypto.js";
import { audit } from "../core/audit.js";

/** Repository for device tokens used by ingest senders (phone automations, apps, scripts). Only hashes are stored. */
export class IngestTokens {
  constructor(private db: Db) {}

  async create(name: string, scopes: string[], actor: string): Promise<{ id: string; token: string }> {
    const token = randomToken("mxi_");
    const id = randomToken("tok_").slice(0, 20);
    await this.db.run(`INSERT INTO ingest_tokens (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id, name, await sha256Hex(token), JSON.stringify(scopes), new Date().toISOString(),
    ]);
    await audit(this.db, actor, "ingest_token.create", id, { name, scopes });
    return { id, token }; // shown once
  }

  /** Imports an existing secret (legacy migration) — stored hashed like any other. */
  async importExisting(name: string, token: string, scopes: string[], actor: string) {
    const id = randomToken("tok_").slice(0, 20);
    await this.db.run(`INSERT INTO ingest_tokens (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id, name, await sha256Hex(token), JSON.stringify(scopes), new Date().toISOString(),
    ]);
    await audit(this.db, actor, "ingest_token.import", id, { name, scopes });
    return id;
  }

  async verify(token: string, scope: string): Promise<{ id: string } | null> {
    const t = await this.identify(token);
    if (!t || (!t.scopes.includes(scope) && !t.scopes.includes("*"))) return null;
    await this.db.run(`UPDATE ingest_tokens SET last_used_at = ? WHERE id = ?`, [new Date().toISOString(), t.id]);
    return { id: t.id };
  }

  /** A live token and its scopes, without counting as a use (status checks are not records). */
  async identify(token: string): Promise<{ id: string; scopes: string[] } | null> {
    if (!token || token.length > 200) return null;
    const row = await this.db.get<{ id: string; scopes: string; revoked_at: string | null }>(
      `SELECT id, scopes, revoked_at FROM ingest_tokens WHERE token_hash = ?`,
      [await sha256Hex(token)],
    );
    if (!row || row.revoked_at) return null;
    return { id: row.id, scopes: JSON.parse(row.scopes) as string[] };
  }

  async list() {
    return this.db.all<{ id: string; name: string; scopes: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
      `SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM ingest_tokens ORDER BY created_at DESC`,
    );
  }

  async revoke(id: string, actor: string) {
    await this.db.run(`UPDATE ingest_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, [new Date().toISOString(), id]);
    await audit(this.db, actor, "ingest_token.revoke", id);
  }
}

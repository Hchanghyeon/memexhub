import type { Db } from "../platform/types.js";
import { pkceS256, randomToken, safeEqual, sha256Hex } from "../core/crypto.js";
import { audit } from "../core/audit.js";

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;
const CODE_TTL_S = 60;

export class OAuthError extends Error {
  constructor(public error: string, public description: string, public status = 400) {
    super(description);
  }
}

/**
 * OAuth 2.1 authorization server for MCP clients (Claude connectors).
 * - Dynamic client registration, but redirect URIs must be https on an allow-listed host.
 * - PKCE S256 mandatory, exact redirect match, one-time 60 s codes.
 * - Opaque tokens stored as SHA-256 hashes. Refresh tokens rotate; reusing an old one revokes the whole family.
 */
export class OAuthServer {
  constructor(
    private db: Db,
    private issuer: string, // PUBLIC_URL
    private allowedRedirectHosts: () => Promise<string[]>,
  ) {}

  get resource() {
    return `${this.issuer}/mcp`;
  }

  protectedResourceMetadata() {
    return { resource: this.resource, authorization_servers: [this.issuer], bearer_methods_supported: ["header"] };
  }

  authorizationServerMetadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      registration_endpoint: `${this.issuer}/register`,
      revocation_endpoint: `${this.issuer}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  private async checkRedirect(uri: string) {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      throw new OAuthError("invalid_redirect_uri", "malformed redirect_uri");
    }
    const hosts = await this.allowedRedirectHosts();
    const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    if (!(u.protocol === "https:" || local) || u.hash) throw new OAuthError("invalid_redirect_uri", "redirect_uri must be https");
    if (!local && !hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)))
      throw new OAuthError("invalid_redirect_uri", `redirect host not allowed: ${u.hostname}`);
  }

  async register(body: any) {
    const uris: unknown = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every((x) => typeof x === "string"))
      throw new OAuthError("invalid_client_metadata", "redirect_uris required");
    for (const u of uris) await this.checkRedirect(u);
    const clientId = randomToken("mxc_").slice(0, 32);
    const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : null;
    await this.db.run(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)`, [
      clientId, name, JSON.stringify(uris), new Date().toISOString(),
    ]);
    await audit(this.db, "anonymous", "oauth.client_registered", clientId, { name, hosts: uris.map((u: string) => new URL(u).hostname) });
    return { client_id: clientId, client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  }

  /** Validates an /authorize request before showing the consent page. */
  async validateAuthorize(q: Record<string, string | undefined>) {
    const client = await this.db.get<{ client_id: string; client_name: string | null; redirect_uris: string; revoked_at: string | null }>(
      `SELECT * FROM oauth_clients WHERE client_id = ?`,
      [q.client_id ?? ""],
    );
    if (!client || client.revoked_at) throw new OAuthError("invalid_client", "unknown client");
    const redirect = q.redirect_uri ?? "";
    if (!(JSON.parse(client.redirect_uris) as string[]).includes(redirect)) throw new OAuthError("invalid_request", "redirect_uri mismatch");
    // From here on errors may be sent to the redirect URI.
    if (q.response_type !== "code") throw new OAuthError("unsupported_response_type", "response_type must be code");
    if (q.code_challenge_method !== "S256" || !q.code_challenge || q.code_challenge.length < 43)
      throw new OAuthError("invalid_request", "PKCE S256 code_challenge required");
    if (q.resource && q.resource !== this.resource) throw new OAuthError("invalid_target", "unknown resource");
    return { clientId: client.client_id, clientName: client.client_name ?? "MCP client", redirect, redirectHost: new URL(redirect).hostname, state: q.state, codeChallenge: q.code_challenge };
  }

  async issueCode(v: { clientId: string; redirect: string; codeChallenge: string }, adminId: string) {
    const code = randomToken("mxa_");
    await this.db.run(
      `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [await sha256Hex(code), v.clientId, v.redirect, v.codeChallenge, this.resource, new Date(Date.now() + CODE_TTL_S * 1000).toISOString()],
    );
    await audit(this.db, `admin:${adminId}`, "oauth.authorized", v.clientId);
    return code;
  }

  private async issueTokens(clientId: string, family: string) {
    const access = randomToken("mxt_");
    const refresh = randomToken("mxr_");
    const now = Date.now();
    await this.db.batch([
      { sql: `INSERT INTO oauth_tokens (token_hash, kind, client_id, family, resource, expires_at, created_at) VALUES (?, 'access', ?, ?, ?, ?, ?)`, params: [await sha256Hex(access), clientId, family, this.resource, new Date(now + ACCESS_TTL_S * 1000).toISOString(), new Date(now).toISOString()] },
      { sql: `INSERT INTO oauth_tokens (token_hash, kind, client_id, family, resource, expires_at, created_at) VALUES (?, 'refresh', ?, ?, ?, ?, ?)`, params: [await sha256Hex(refresh), clientId, family, this.resource, new Date(now + REFRESH_TTL_S * 1000).toISOString(), new Date(now).toISOString()] },
    ]);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh };
  }

  async token(form: Record<string, string>) {
    if (form.grant_type === "authorization_code") {
      const row = await this.db.get<any>(`SELECT * FROM oauth_codes WHERE code_hash = ?`, [await sha256Hex(form.code ?? "")]);
      if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw new OAuthError("invalid_grant", "invalid or expired code");
      await this.db.run(`UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?`, [new Date().toISOString(), row.code_hash]);
      if (row.client_id !== form.client_id || row.redirect_uri !== form.redirect_uri) throw new OAuthError("invalid_grant", "client or redirect mismatch");
      if (!form.code_verifier || !safeEqual(await pkceS256(form.code_verifier), row.code_challenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
      return this.issueTokens(row.client_id, randomToken("fam_").slice(0, 24));
    }
    if (form.grant_type === "refresh_token") {
      const h = await sha256Hex(form.refresh_token ?? "");
      const row = await this.db.get<any>(`SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'`, [h]);
      if (!row || row.revoked_at || Date.parse(row.expires_at) < Date.now()) throw new OAuthError("invalid_grant", "invalid refresh token");
      if (form.client_id && form.client_id !== row.client_id) throw new OAuthError("invalid_grant", "client mismatch");
      if (row.used_at) {
        // Reuse of a rotated refresh token = likely theft. Kill the whole family.
        await this.revokeFamily(row.family, "oauth.refresh_reuse_detected");
        throw new OAuthError("invalid_grant", "refresh token reuse detected");
      }
      await this.db.run(`UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ?`, [new Date().toISOString(), h]);
      return this.issueTokens(row.client_id, row.family);
    }
    throw new OAuthError("unsupported_grant_type", "unsupported grant_type");
  }

  async revokeToken(token: string) {
    const row = await this.db.get<{ family: string }>(`SELECT family FROM oauth_tokens WHERE token_hash = ?`, [await sha256Hex(token)]);
    if (row) await this.revokeFamily(row.family, "oauth.revoked");
  }

  async revokeFamily(family: string, reason: string) {
    await this.db.run(`UPDATE oauth_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL`, [new Date().toISOString(), family]);
    await audit(this.db, "system", reason, family);
  }

  async revokeClient(clientId: string, actor: string) {
    const now = new Date().toISOString();
    await this.db.batch([
      { sql: `UPDATE oauth_clients SET revoked_at = ? WHERE client_id = ?`, params: [now, clientId] },
      { sql: `UPDATE oauth_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL`, params: [now, clientId] },
    ]);
    await audit(this.db, actor, "oauth.client_revoked", clientId);
  }

  /** Bearer check for /mcp. */
  async verifyAccess(token: string): Promise<{ clientId: string } | null> {
    if (!token || token.length > 200) return null;
    const row = await this.db.get<any>(`SELECT client_id, expires_at, revoked_at, resource FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'`, [await sha256Hex(token)]);
    if (!row || row.revoked_at || Date.parse(row.expires_at) < Date.now() || row.resource !== this.resource) return null;
    return { clientId: row.client_id };
  }

  async clients() {
    return this.db.all<any>(
      `SELECT c.client_id, c.client_name, c.created_at, c.revoked_at,
              (SELECT MAX(created_at) FROM oauth_tokens t WHERE t.client_id = c.client_id) AS last_token_at
         FROM oauth_clients c ORDER BY c.created_at DESC`,
    );
  }
}

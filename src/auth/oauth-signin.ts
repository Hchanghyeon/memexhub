import type { Connections } from "../core/connections.js";
import type { Cursors } from "../core/cursors.js";
import { pkceS256, randomToken, sha256Hex } from "../core/crypto.js";

/** How one service does "Sign in with …" for a connection (authorization code + PKCE, offline access). */
export interface OAuthSpec {
  provider: string; // connection provider id ("google", "spotify")
  title: string;
  auth: string;
  token: string;
  /** Hosts the sign-in itself calls (token, user info). */
  hosts: string[];
  /** Minimal scopes for a connection kind. */
  scopes(kind: string): string[];
  /** Extra authorization parameters (e.g. Google's offline access). */
  params?: Record<string, string>;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "body" | "basic";
  /** Account label to tell connections apart (an e-mail or user name). */
  who(accessToken: string, f: typeof fetch): Promise<string>;
  /** Field in the connection config that holds the label. */
  whoField: string;
}

/**
 * "Sign in with …" for a connection. The admin starts it; the service redirects to PUBLIC_URL/oauth/<provider>/callback
 * (https, as the services require). The one-time `state` (hashed, 10 minutes) binds the callback to the connection
 * and the PKCE verifier. The refresh token is stored encrypted with the connection.
 */
export class OAuthSignIn {
  constructor(
    readonly spec: OAuthSpec,
    private connections: Connections,
    private cursors: Cursors,
    private publicUrl: string,
    private fetch: typeof globalThis.fetch,
    private now: () => Date = () => new Date(),
  ) {}

  get redirectUri() {
    return `${this.publicUrl.replace(/\/+$/, "")}/oauth/${this.spec.provider}/callback`;
  }

  async start(connectionId: string): Promise<string> {
    const c = await this.connections.byId(connectionId);
    if (!c || c.provider !== this.spec.provider) throw new Error(`not a ${this.spec.title} connection`);
    const state = randomToken();
    const verifier = randomToken() + randomToken(); // 86 chars (PKCE allows 43–128)
    await this.cursors.set(`${this.spec.provider}.signin:${await sha256Hex(state)}`, { connectionId, verifier, exp: +this.now() + 600_000 });
    const q = new URLSearchParams({
      client_id: String(c.config.clientId ?? ""),
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: this.spec.scopes(c.kind).join(" "),
      ...(this.spec.params ?? {}),
      state,
      code_challenge: await pkceS256(verifier),
      code_challenge_method: "S256",
    });
    return `${this.spec.auth}?${q}`;
  }

  /** Returns the account label. Every failure is a generic message; nothing is stored unless all checks pass. */
  async finish(state: string, code: string): Promise<{ connectionId: string; email: string }> {
    if (!state || !code) throw new Error("missing state or code");
    const key = `${this.spec.provider}.signin:${await sha256Hex(state)}`;
    const pending = await this.cursors.get<{ connectionId: string; verifier: string; exp: number }>(key);
    await this.cursors.set(key, { used: true }); // one-time, even if the rest fails
    if (!pending?.verifier || pending.exp < +this.now()) throw new Error("this sign-in link expired: start again from the admin UI");
    const c = await this.connections.byId(pending.connectionId);
    if (!c) throw new Error("the connection no longer exists");
    const { clientSecret } = await this.connections.secretsOf(c.id);
    const clientId = String(c.config.clientId ?? "");
    const form = new URLSearchParams({ code, code_verifier: pending.verifier, redirect_uri: this.redirectUri, grant_type: "authorization_code" });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (this.spec.clientAuth === "basic") headers.authorization = `Basic ${btoa(`${clientId}:${clientSecret ?? ""}`)}`;
    else (form.set("client_id", clientId), form.set("client_secret", clientSecret ?? ""));
    const r = await this.fetch(this.spec.token, { method: "POST", headers, body: form });
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
    if (!r.ok || !tok.access_token) throw new Error(`${this.spec.title} refused the sign-in (${tok.error ?? r.status})`);
    if (!tok.refresh_token) throw new Error(`${this.spec.title} sent no refresh token: remove memexhub from your account's connected apps, then sign in again`);
    const label = (await this.spec.who(tok.access_token, this.fetch).catch(() => "")).slice(0, 200);
    await this.connections.patch(c.id, { config: { [this.spec.whoField]: label }, secrets: { refreshToken: tok.refresh_token } }, `${this.spec.provider}-signin`);
    return { connectionId: c.id, email: label };
  }
}

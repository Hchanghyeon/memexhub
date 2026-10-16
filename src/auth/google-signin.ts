import type { Connections } from "../core/connections.js";
import type { Cursors } from "../core/cursors.js";
import { pkceS256, randomToken, sha256Hex } from "../core/crypto.js";
import { GOOGLE } from "../providers/google/auth.js";

/**
 * "Sign in with Google" for a connection: authorization code + PKCE, offline access, minimal scopes.
 * The admin starts it; Google redirects to PUBLIC_URL/oauth/google/callback (https, as Google requires).
 * The one-time `state` (hashed, 10 minutes) binds the callback to the connection and the PKCE verifier.
 */
export class GoogleSignIn {
  constructor(
    private connections: Connections,
    private cursors: Cursors,
    private publicUrl: string,
    private fetch: typeof globalThis.fetch,
    private now: () => Date = () => new Date(),
  ) {}

  get redirectUri() {
    return `${this.publicUrl.replace(/\/+$/, "")}/oauth/google/callback`;
  }

  async start(connectionId: string): Promise<string> {
    const c = await this.connections.byId(connectionId);
    if (!c || c.provider !== "google") throw new Error("not a Google connection");
    const state = randomToken();
    const verifier = randomToken() + randomToken(); // 86 chars (PKCE allows 43–128)
    await this.cursors.set(`google.signin:${await sha256Hex(state)}`, { connectionId, verifier, exp: +this.now() + 600_000 });
    const q = new URLSearchParams({
      client_id: String(c.config.clientId ?? ""),
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: (GOOGLE.scopes[c.kind] ?? GOOGLE.scopes.tasks!).join(" "),
      access_type: "offline",
      prompt: "consent select_account",
      state,
      code_challenge: await pkceS256(verifier),
      code_challenge_method: "S256",
    });
    return `${GOOGLE.auth}?${q}`;
  }

  /** Returns the signed-in e-mail. Every failure is a generic message; nothing is stored unless all checks pass. */
  async finish(state: string, code: string): Promise<{ connectionId: string; email: string }> {
    if (!state || !code) throw new Error("missing state or code");
    const key = `google.signin:${await sha256Hex(state)}`;
    const pending = await this.cursors.get<{ connectionId: string; verifier: string; exp: number }>(key);
    await this.cursors.set(key, { used: true }); // one-time, even if the rest fails
    if (!pending?.verifier || pending.exp < +this.now()) throw new Error("this sign-in link expired — start again from the admin UI");
    const c = await this.connections.byId(pending.connectionId);
    if (!c) throw new Error("the connection no longer exists");
    const { clientSecret } = await this.connections.secretsOf(c.id);
    const r = await this.fetch(GOOGLE.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: String(c.config.clientId ?? ""), client_secret: clientSecret ?? "", code, code_verifier: pending.verifier, redirect_uri: this.redirectUri, grant_type: "authorization_code" }),
    });
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
    if (!r.ok || !tok.access_token) throw new Error(`Google refused the sign-in (${tok.error ?? r.status})`);
    if (!tok.refresh_token) throw new Error("Google sent no refresh token — remove memexhub under Google Account → Security → Third-party access, then sign in again");
    const ui = await this.fetch(GOOGLE.userinfo, { headers: { authorization: `Bearer ${tok.access_token}` } });
    const email = String(((await ui.json().catch(() => ({}))) as { email?: string }).email ?? "").slice(0, 200);
    await this.connections.patch(c.id, { config: { email }, secrets: { refreshToken: tok.refresh_token } }, "google-signin");
    return { connectionId: c.id, email };
  }
}


/** Google endpoints and the refresh-token flow shared by the Google connections (Tasks, Calendar). */
export const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  /** Hosts used by sign-in itself. */
  hosts: ["oauth2.googleapis.com", "openidconnect.googleapis.com"],
  /** Minimal scope per connection kind, plus the e-mail to tell accounts apart. */
  scopes: {
    tasks: ["openid", "email", "https://www.googleapis.com/auth/tasks"],
    calendar: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
  } as Record<string, string[]>,
};

export class GoogleError extends Error {}

/** Access tokens from a refresh token, cached until a minute before they expire. */
export class GoogleToken {
  private access?: { token: string; until: number };
  constructor(
    private o: { clientId: string; clientSecret: string; refreshToken?: string },
    private f: typeof fetch,
    private now: () => number = () => Date.now(),
  ) {}

  async get(force = false) {
    if (!this.o.refreshToken) throw new GoogleError("not signed in: admin UI → Connections → Sign in with Google");
    if (!force && this.access && this.access.until > this.now() + 60_000) return this.access.token;
    const r = await this.f(GOOGLE.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, refresh_token: this.o.refreshToken, grant_type: "refresh_token" }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !j.access_token) throw new GoogleError(`Google sign-in expired or revoked (${j.error ?? r.status}): sign in again`);
    this.access = { token: j.access_token, until: this.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /** JSON API call with one retry on 401 (a fresh token). */
  async api(url: URL, init: { method?: string; body?: unknown } = {}): Promise<any> {
    for (const retry of [false, true]) {
      const r = await this.f(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${await this.get(retry)}`, "content-type": "application/json" },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      if (r.status === 401 && !retry) continue;
      if (!r.ok) throw new GoogleError(`Google ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const text = await r.text();
      return text ? JSON.parse(text) : {};
    }
  }
}


/** Sign-in description for OAuthSignIn. */
export const GOOGLE_SIGNIN = {
  provider: "google",
  title: "Google",
  auth: GOOGLE.auth,
  token: GOOGLE.token,
  hosts: GOOGLE.hosts,
  scopes: (kind: string) => GOOGLE.scopes[kind] ?? GOOGLE.scopes.tasks!,
  params: { access_type: "offline", prompt: "consent select_account" },
  clientAuth: "body" as const,
  whoField: "email",
  who: async (token: string, f: typeof fetch) => String(((await (await f(GOOGLE.userinfo, { headers: { authorization: `Bearer ${token}` } })).json()) as { email?: string }).email ?? ""),
};

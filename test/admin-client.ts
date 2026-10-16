import { Hono } from "hono";
import type { Hub } from "../src/hub.js";
import { adminApp, type AdminAssets } from "../src/admin/app.js";

/**
 * The admin API as the web app uses it: mounted at /admin, a session cookie, the CSRF token from /api/session
 * in the X-CSRF header. `ip` decides home network vs internet.
 */
export function adminClient(hub: Hub, o: { ip?: string; assets?: AdminAssets; origin?: string } = {}) {
  const app = new Hono().use("*", (c: any, n: any) => (c.set("ip", o.ip ?? "10.0.0.9"), n())).route("/admin", adminApp(hub, { vaultRoots: ["/vaults"], builtinVault: "", base: "/admin", assets: o.assets }));
  const origin = o.origin ?? "http://10.0.0.2";
  let cookie = "";
  let csrf = "";
  const req = (path: string, init: RequestInit = {}) => app.request(`${origin}/admin/api${path}`, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } });
  const client = {
    app,
    req,
    get: (path: string) => req(path),
    json: async <T = any>(path: string): Promise<T> => (await req(path)).json() as Promise<T>,
    post: (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
      req(path, { method: "POST", headers: { "content-type": "application/json", "x-csrf": csrf, ...headers }, body: JSON.stringify(body) }),
    upload: (path: string, name: string, text: string, extra: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.set("file", new File([text], name));
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      return req(path, { method: "POST", headers: { "x-csrf": csrf }, body: fd });
    },
    /** Keep the cookie from a sign-in / setup response and fetch the CSRF token. */
    async adopt(r: Response) {
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      const s = (await (await req("/session")).json()) as { csrf?: string };
      csrf = s.csrf ?? "";
      return r;
    },
    async login(username = "owner", password = "a-long-test-password", totp?: string) {
      return client.adopt(await client.post("/login", { username, password, totp }));
    },
    get cookie() { return cookie; },
    get csrf() { return csrf; },
  };
  return client;
}

/** @jsxImportSource hono/jsx */
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import { inAny, PRIVATE_CIDRS } from "../core/ip.js";
import { safeEqual } from "../core/crypto.js";
import { securityHeaders } from "../http/common.js";
import { ANTHROPIC_OUTBOUND_CIDRS } from "../core/settings.js";

type Vars = { Variables: { ip: string; adminId: string; csrf: string } };
const COOKIE = "mx_admin";

/** Admin surface. Private networks only unless explicitly opened (and then TOTP is required). */
export function adminApp(hub: Hub, opts: { vaultRoots: string[]; builtinVault: string }) {
  const app = new Hono<Vars>();
  app.use("*", securityHeaders);

  app.use("*", async (c, next) => {
    const s = await hub.settings.get();
    if (!s.admin.allowPublic && !inAny(c.get("ip"), PRIVATE_CIDRS)) return c.text("admin is only available from your private network", 403);
    await next();
  });

  const secure = (c: Context) => new URL(c.req.url).protocol === "https:";
  const startSession = async (c: Context, adminId: string) => {
    const { sid } = await hub.admin.createSession(adminId);
    setCookie(c, COOKIE, sid, { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/" });
  };

  // ---- first run ----
  app.get("/setup", async (c) => {
    if (await hub.admin.hasAdmin()) return c.redirect("/login");
    return c.html(
      <Layout title="Set up memexhub">
        <h1>Set up memexhub</h1>
        <p>Enter the one-time setup code printed in the server log, then create the admin account.</p>
        <form method="post">
          <label>Setup code<input name="code" required autocomplete="off" /></label>
          <label>Admin username<input name="username" required /></label>
          <label>Password (12+ characters)<input name="password" type="password" minlength={12} required /></label>
          <button>Create admin</button>
        </form>
      </Layout>,
    );
  });
  app.post("/setup", async (c) => {
    if (await hub.admin.hasAdmin()) return c.redirect("/login");
    const f = await c.req.parseBody();
    if (!(await hub.admin.checkSetupCode(String(f.code ?? "")))) return c.text("wrong setup code", 403);
    try {
      const id = await hub.admin.createAdmin(String(f.username), String(f.password), `setup:${c.get("ip")}`);
      await startSession(c, id);
      return c.redirect("/");
    } catch (e) {
      return c.text((e as Error).message, 400);
    }
  });

  app.get("/login", (c) =>
    c.html(
      <Layout title="Log in · memexhub">
        <h1>memexhub admin</h1>
        <form method="post">
          <label>Username<input name="username" autocomplete="username" required /></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
          <label>Authenticator code (if enabled)<input name="totp" inputmode="numeric" /></label>
          <button>Log in</button>
        </form>
      </Layout>,
    ),
  );
  app.post("/login", async (c) => {
    const f = await c.req.parseBody();
    const id = await hub.admin.login(String(f.username ?? ""), String(f.password ?? ""), String(f.totp ?? "") || undefined, `${c.get("ip")}|${f.username}`);
    if (!id) return c.text("login failed", 401);
    await startSession(c, id);
    return c.redirect("/");
  });

  // ---- everything below needs a session ----
  app.use("*", async (c, next) => {
    if (!(await hub.admin.hasAdmin())) return c.redirect("/setup");
    const sess = await hub.admin.session(getCookie(c, COOKIE));
    if (!sess) return c.redirect("/login");
    if (c.req.method === "POST") {
      const f = await c.req.parseBody();
      if (!safeEqual(String(f.csrf ?? ""), sess.csrf)) return c.text("bad csrf token", 403);
    }
    c.set("adminId", sess.adminId);
    c.set("csrf", sess.csrf);
    await next();
  });
  const actor = (c: Context<Vars>) => `admin:${c.get("adminId")}`;
  const Csrf = (p: { c: Context<Vars> }) => <input type="hidden" name="csrf" value={p.c.get("csrf")} />;

  app.get("/", async (c) => {
    const s = await hub.settings.get();
    const storage = await hub.connections.list("storage");
    const tokens = await hub.ingestTokens.list();
    const clients = await hub.oauth.clients();
    const tools = await hub.visibleTools();
    const totp = await hub.admin.hasTotp(c.get("adminId"));
    const newToken = c.req.query("new_token");
    return c.html(
      <Layout title="memexhub">
        <h1>memexhub</h1>
        <nav><a href="#vault">Vault</a><a href="#claude">Claude</a><a href="#devices">Devices</a><a href="#security">Security</a></nav>

        <div class="card" id="vault">
          <h2>Vault</h2>
          <p>{hub.vault ? <span class="ok">connected ({storage[0]?.provider})</span> : <span class="err">not connected</span>}</p>
          <form method="post" action="/vault">
            <Csrf c={c} />
            <label>Where should your vault live?
              <select name="provider">
                <option value="builtin">Create on this server (recommended)</option>
                <option value="folder">Existing folder on this server</option>
                <option value="webdav">WebDAV</option>
              </select>
            </label>
            <label>Folder (for "existing folder", under {opts.vaultRoots.join(" or ")})<input name="path" placeholder={`${opts.vaultRoots[0]}/my-vault`} /></label>
            <label>WebDAV URL<input name="url" placeholder="https://dav.example.com/vault" /></label>
            <label>WebDAV username<input name="username" autocomplete="off" /></label>
            <label>WebDAV password (stored encrypted, never shown again)<input name="password" type="password" autocomplete="new-password" /></label>
            <button>Save &amp; test</button>
          </form>
        </div>

        <div class="card" id="claude">
          <h2>Claude connector</h2>
          <p>In the Claude app: Settings → Connectors → Add custom connector → paste:</p>
          <pre>{hub.env.PUBLIC_URL}/mcp</pre>
          <p>Tools visible to Claude ({tools.length}): <code>{tools.map((t) => t.name).join(", ")}</code></p>
          <form method="post" action="/settings/language">
            <Csrf c={c} />
            <label>Tool description language
              <select name="toolLanguage">
                {(["en", "ko", "both"] as const).map((l) => <option value={l} selected={s.toolLanguage === l}>{l}</option>)}
              </select>
            </label>
            <button>Save</button>
          </form>
          <h3>Approved clients</h3>
          <table>
            <tr><th>Client</th><th>Created</th><th>Last token</th><th></th></tr>
            {clients.map((cl) => (
              <tr>
                <td>{cl.client_name ?? cl.client_id}</td><td>{String(cl.created_at).slice(0, 16)}</td><td>{String(cl.last_token_at ?? "—").slice(0, 16)}</td>
                <td>{cl.revoked_at ? "revoked" : (
                  <form method="post" action={`/oauth/${cl.client_id}/revoke`}><Csrf c={c} /><button class="secondary">Revoke</button></form>
                )}</td>
              </tr>
            ))}
          </table>
        </div>

        <div class="card" id="devices">
          <h2>Device tokens (phone shortcuts)</h2>
          {newToken && <p class="ok">New token — copy it now, it will not be shown again:<br /><code>{newToken}</code></p>}
          <form method="post" action="/tokens">
            <Csrf c={c} />
            <label>Name<input name="name" placeholder="my phone" required /></label>
            <label>Scopes (comma separated)<input name="scopes" value="ledger,health" /></label>
            <button>Create token</button>
          </form>
          <table>
            <tr><th>Name</th><th>Scopes</th><th>Last used</th><th></th></tr>
            {tokens.map((t) => (
              <tr>
                <td>{t.name}</td><td>{JSON.parse(t.scopes).join(", ")}</td><td>{String(t.last_used_at ?? "never").slice(0, 16)}</td>
                <td>{t.revoked_at ? "revoked" : (
                  <form method="post" action={`/tokens/${t.id}/revoke`}><Csrf c={c} /><button class="secondary">Revoke</button></form>
                )}</td>
              </tr>
            ))}
          </table>
        </div>

        <div class="card" id="security">
          <h2>Security</h2>
          <ul>
            <li>Two-factor: {totp ? <span class="ok">on</span> : <span class="err">off</span>}</li>
            <li>MCP IP allowlist: {s.mcp.enforceAllow ? <span class="ok">enforced ({s.mcp.allowCidrs.join(", ")})</span> : <span class="err">off</span>}</li>
            <li>Vault read-only: {s.vault.readOnly ? "yes" : "no"} · protected paths: <code>{s.vault.protectedPaths.join(", ")}</code></li>
          </ul>
          {!totp && (
            <form method="post" action="/totp"><Csrf c={c} /><button>Enable two-factor</button></form>
          )}
          <form method="post" action="/mcp-allow">
            <Csrf c={c} />
            <input type="hidden" name="enforce" value={s.mcp.enforceAllow ? "0" : "1"} />
            <button>{s.mcp.enforceAllow ? "Turn off IP allowlist" : "Only allow Anthropic servers to call /mcp"}</button>
          </form>
          <form method="post" action="/logout"><Csrf c={c} /><button class="secondary">Log out</button></form>
        </div>
      </Layout>,
    );
  });

  app.post("/vault", async (c) => {
    const f = await c.req.parseBody();
    const provider = String(f.provider);
    try {
      if (provider === "builtin") {
        await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: { path: opts.builtinVault } }, actor(c));
      } else if (provider === "folder") {
        await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: { path: String(f.path ?? "") } }, actor(c));
      } else if (provider === "webdav") {
        await hub.connections.upsert(
          { kind: "storage", provider: "webdav", name: "vault", config: { url: String(f.url), username: String(f.username ?? "") || undefined }, secrets: f.password ? { password: String(f.password) } : undefined },
          actor(c),
        );
      } else return c.text("unknown provider", 400);
      const s = await hub.settings.get();
      await hub.settings.set("vault", { ...s.vault, connection: "vault" });
      await hub.reload();
      if (!hub.vault) return c.text("saved, but the vault could not be opened — check the path or credentials", 400);
      await hub.vault.list(); // connection test
      const con = await hub.connections.get("storage", "vault");
      if (con) await hub.connections.setStatus(con.id, true);
      return c.redirect("/#vault");
    } catch (e) {
      return c.text(`vault test failed: ${(e as Error).message}`, 400);
    }
  });

  app.post("/settings/language", async (c) => {
    const f = await c.req.parseBody();
    const l = String(f.toolLanguage);
    if (l === "en" || l === "ko" || l === "both") await hub.settings.set("toolLanguage", l);
    return c.redirect("/#claude");
  });

  app.post("/tokens", async (c) => {
    const f = await c.req.parseBody();
    const scopes = String(f.scopes ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z*]+$/.test(s));
    const { token } = await hub.ingestTokens.create(String(f.name).slice(0, 60), scopes, actor(c));
    return c.redirect(`/?new_token=${encodeURIComponent(token)}#devices`);
  });
  app.post("/tokens/:id/revoke", async (c) => {
    await hub.ingestTokens.revoke(c.req.param("id"), actor(c));
    return c.redirect("/#devices");
  });
  app.post("/oauth/:id/revoke", async (c) => {
    await hub.oauth.revokeClient(c.req.param("id"), actor(c));
    return c.redirect("/#claude");
  });
  app.post("/totp", async (c) => {
    const secret = await hub.admin.enableTotp(c.get("adminId"));
    const uri = `otpauth://totp/memexhub:admin?secret=${secret}&issuer=memexhub`;
    return c.html(
      <Layout title="Two-factor">
        <h1>Two-factor enabled</h1>
        <p>Add this to your authenticator app (it will not be shown again):</p>
        <pre>{secret}</pre>
        <p class="muted">{uri}</p>
        <a href="/">Back</a>
      </Layout>,
    );
  });
  app.post("/mcp-allow", async (c) => {
    const f = await c.req.parseBody();
    await hub.settings.set("mcp", { allowCidrs: ANTHROPIC_OUTBOUND_CIDRS, enforceAllow: f.enforce === "1" });
    return c.redirect("/#security");
  });
  app.post("/logout", async (c) => {
    const sid = getCookie(c, COOKIE);
    if (sid) await hub.admin.logout(sid);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login");
  });

  return app;
}

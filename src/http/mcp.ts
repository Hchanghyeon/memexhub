import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hub } from "../hub.js";
import { OAuthError } from "../auth/oauth.js";
import { inAny } from "../core/ip.js";
import { readBodyLimited, rateLimit, securityHeaders } from "./common.js";
import { consentPage } from "../admin/consent.js";

type Vars = { Variables: { ip: string } };

/** MCP surface: /mcp (bearer) + OAuth endpoints. Claude connects here. */
export function mcpApp(hub: Hub) {
  const app = new Hono<Vars>();
  app.use("*", securityHeaders);

  app.get("/healthz", (c) => c.text("ok"));

  // Google sign-in for a Tasks connection lands here (Google requires https). The one-time state is the only key.
  app.get("/oauth/google/callback", rateLimit(10, (c) => c.get("ip")), async (c) => {
    const page = (title: string, msg: string, status: 200 | 400) =>
      c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:15px system-ui;max-width:520px;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">${title}</h1><p>${msg}</p></body>`, status);
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    if (c.req.query("error")) return page("Sign-in cancelled", "Nothing was changed. You can close this tab.", 400);
    try {
      const r = await hub.google.finish(c.req.query("state") ?? "", c.req.query("code") ?? "");
      await hub.reload();
      return page("Connected", `Signed in as <b>${esc(r.email || "your Google account")}</b>. You can close this tab and return to the admin UI.`, 200);
    } catch (e) {
      return page("Sign-in failed", esc((e as Error).message.slice(0, 200)), 400);
    }
  });
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(hub.oauth.protectedResourceMetadata()));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(hub.oauth.protectedResourceMetadata()));
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(hub.oauth.authorizationServerMetadata()));

  const oauthErr = (c: any, e: unknown) => {
    if (e instanceof OAuthError) return c.json({ error: e.error, error_description: e.description }, e.status);
    hub.platform.log.error("oauth failure");
    return c.json({ error: "server_error" }, 500);
  };

  app.post("/register", rateLimit(10, (c) => c.get("ip")), async (c) => {
    if (!(await hub.admin.hasAdmin())) return c.json({ error: "setup_required" }, 503);
    const raw = await readBodyLimited(c.req.raw, 8192);
    if (raw === null) return c.json({ error: "too_large" }, 413);
    try {
      return c.json(await hub.oauth.register(JSON.parse(raw || "{}")), 201);
    } catch (e) {
      return oauthErr(c, e);
    }
  });

  app.get("/authorize", async (c) => {
    try {
      const v = await hub.oauth.validateAuthorize(c.req.query());
      return c.html(consentPage({ v, query: c.req.url.split("?")[1] ?? "", needTotp: false }));
    } catch (e) {
      return oauthErr(c, e);
    }
  });

  app.post("/authorize", rateLimit(10, (c) => c.get("ip")), async (c) => {
    const form = await c.req.parseBody();
    const q = Object.fromEntries(new URLSearchParams(String(form.query ?? "")));
    let v;
    try {
      v = await hub.oauth.validateAuthorize(q);
    } catch (e) {
      return oauthErr(c, e);
    }
    const adminId = await hub.admin.login(String(form.username ?? ""), String(form.password ?? ""), String(form.totp ?? "") || undefined, `${c.get("ip")}|${form.username}`);
    if (!adminId) return c.html(consentPage({ v, query: String(form.query), error: "Login failed", needTotp: true }), 401);
    const target = new URL(v.redirect);
    if (form.decision !== "allow") {
      target.searchParams.set("error", "access_denied");
    } else {
      target.searchParams.set("code", await hub.oauth.issueCode(v, adminId));
    }
    if (v.state) target.searchParams.set("state", v.state);
    return c.redirect(target.toString(), 302);
  });

  app.post("/token", rateLimit(30, (c) => c.get("ip")), async (c) => {
    try {
      const form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
      return c.json(await hub.oauth.token(form));
    } catch (e) {
      return oauthErr(c, e);
    }
  });

  app.post("/revoke", async (c) => {
    const form = await c.req.parseBody();
    await hub.oauth.revokeToken(String(form.token ?? ""));
    return c.body(null, 200);
  });

  app.all("/mcp", rateLimit(240, (c) => c.get("ip")), async (c) => {
    const s = await hub.settings.get();
    if (s.mcp.enforceAllow && s.mcp.allowCidrs.length && !inAny(c.get("ip"), s.mcp.allowCidrs)) return c.json({ error: "forbidden" }, 403);
    if (!(await hub.admin.hasAdmin())) return c.json({ error: "setup_required" }, 503);
    const auth = c.req.header("authorization") ?? "";
    const who = auth.toLowerCase().startsWith("bearer ") ? await hub.oauth.verifyAccess(auth.slice(7).trim()) : null;
    if (!who) {
      c.header("WWW-Authenticate", `Bearer resource_metadata="${hub.env.PUBLIC_URL}/.well-known/oauth-protected-resource"`);
      return c.json({ error: "unauthorized" }, 401);
    }
    const origin = c.req.header("origin");
    if (origin && !["https://claude.ai", "https://claude.com", hub.env.PUBLIC_URL].includes(origin)) return c.json({ error: "origin_not_allowed" }, 403);
    const server = await hub.buildMcpServer(`mcp:${who.clientId}`);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}

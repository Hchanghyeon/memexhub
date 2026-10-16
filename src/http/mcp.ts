import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { Hub } from "../hub.js";
import { OAuthError } from "../auth/oauth.js";
import { inAny } from "../core/ip.js";
import { readBodyLimited, rateLimit, securityHeaders } from "./common.js";
import { consentPage } from "../admin/consent.js";
import { langOf } from "../admin/lang.js";
import { recordAccess } from "../core/access.js";

type Vars = { Variables: { ip: string } };

/**
 * Clients move to newer MCP protocol versions before this SDK knows them (Claude sends e.g. 2026-07-28).
 * The messages we serve (initialize, tools/list, tools/call) are unchanged, so a newer version header is
 * answered as the newest version we support instead of a 400. Older, unknown versions are still refused.
 */
const isNewerProtocol = (v: string | null | undefined) => !!v && !SUPPORTED_PROTOCOL_VERSIONS.includes(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > LATEST_PROTOCOL_VERSION;

/**
 * Newer protocol revisions require every result to say it is final (`resultType: "complete"`); earlier
 * revisions treat a missing field as complete. Our results are always complete, so we add it for those clients.
 */
export async function withResultType(res: Response): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: res.status, headers: res.headers });
  }
  const mark = (m: any) => (m && typeof m === "object" && m.result && typeof m.result === "object" && !("resultType" in m.result) ? { ...m, result: { ...m.result, resultType: "complete" } } : m);
  const out = Array.isArray(body) ? body.map(mark) : mark(body);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(out), { status: res.status, headers });
}

export function withKnownProtocolVersion(req: Request): Request {
  const v = req.headers.get("mcp-protocol-version");
  if (!isNewerProtocol(v)) return req;
  const headers = new Headers(req.headers);
  headers.set("mcp-protocol-version", LATEST_PROTOCOL_VERSION);
  return new Request(req, { headers });
}

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
      return c.html(consentPage({ v, query: c.req.url.split("?")[1] ?? "", needTotp: false, lang: await langOf(hub, c) }));
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
    await recordAccess(hub.platform.db, { kind: "claude.authorize", ip: c.get("ip"), ok: !!adminId, who: v.clientName, detail: adminId ? String(form.decision ?? "") : `sign-in failed: ${String(form.username ?? "").slice(0, 40)}` }, { now: hub.platform.now() });
    if (!adminId) return c.html(consentPage({ v, query: String(form.query), error: "Login failed", needTotp: true, lang: await langOf(hub, c) }), 401);
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
      const out = await hub.oauth.token(form);
      await recordAccess(hub.platform.db, { kind: "claude.token", ip: c.get("ip"), ok: true, who: form.client_id }, { now: hub.platform.now(), windowMinutes: 60 });
      return c.json(out);
    } catch (e) {
      await recordAccess(hub.platform.db, { kind: "claude.token", ip: c.get("ip"), ok: false, detail: (e as Error).message }, { now: hub.platform.now(), windowMinutes: 10 });
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
    await recordAccess(hub.platform.db, { kind: "claude", ip: c.get("ip"), ok: !!who, who: who?.clientId }, { now: hub.platform.now(), windowMinutes: who ? 60 : 10 });
    if (!who) {
      c.header("WWW-Authenticate", `Bearer resource_metadata="${hub.env.PUBLIC_URL}/.well-known/oauth-protected-resource"`);
      return c.json({ error: "unauthorized" }, 401);
    }
    const origin = c.req.header("origin");
    if (origin && !["https://claude.ai", "https://claude.com", hub.env.PUBLIC_URL].includes(origin)) return c.json({ error: "origin_not_allowed" }, 403);
    const server = await hub.buildMcpServer(`mcp:${who.clientId}`);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const newer = isNewerProtocol(c.req.header("mcp-protocol-version"));
    const res = await transport.handleRequest(withKnownProtocolVersion(c.req.raw));
    return newer ? await withResultType(res) : res;
  });

  return app;
}

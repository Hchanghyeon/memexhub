import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { Hub } from "../hub.js";
import { inAny, PRIVATE_CIDRS } from "../core/ip.js";
import { safeEqual } from "../core/crypto.js";
import { audit } from "../core/audit.js";
import { listAccess, recordAccess } from "../core/access.js";
import { ANTHROPIC_OUTBOUND_CIDRS, type Settings } from "../core/settings.js";
import { PRESETS, RolesSchema } from "../modules/wiki/layout.js";
import { effectiveRules } from "../modules/wiki/lint.js";
import { fieldsOf, INTERNAL } from "./forms.js";
import { exportBackup, importBackup } from "../core/backup.js";
import { importLedgerLines } from "../modules/ledger/import.js";
import { importHealthDays } from "../modules/health/import.js";
import type { LedgerAdmin } from "../modules/ledger/admin-api.js";
import { CHANNELS } from "../modules/ledger/messages/types.js";

type Vars = { Variables: { ip: string; adminId: string; csrf: string } };
export const SESSION_COOKIE = "mx_admin";

/** A security check by id; the web app words it. "high" ones are shown in red. */
export interface Check { id: string; ok: boolean; level?: "high"; n?: number }

export function securityChecks(o: { totp: boolean; s: Settings; vault: boolean; davTokens: number; publicUrl: string; lastBackup?: Date | null; now?: Date }): Check[] {
  const out: Check[] = [];
  out.push(o.totp ? { id: "totp_on", ok: true } : { id: o.s.admin.allowPublic ? "totp_off_public" : "totp_off", ok: false, level: o.s.admin.allowPublic ? "high" : undefined });
  out.push(o.s.admin.allowPublic ? { id: "admin_public", ok: false } : { id: "admin_home", ok: true });
  out.push(o.s.mcp.enforceAllow ? { id: "mcp_anthropic", ok: true } : { id: "mcp_open", ok: false });
  if (o.publicUrl.startsWith("http://")) out.push({ id: "http_url", ok: false, level: "high" });
  if (!o.vault) out.push({ id: "no_vault", ok: false });
  if (o.s.dav.enabled) out.push(o.davTokens ? { id: "dav_devices", ok: true, n: o.davTokens } : { id: "dav_no_devices", ok: false });
  if (o.s.vault.readOnly) out.push({ id: "read_only", ok: true });
  if (o.lastBackup !== undefined) out.push(o.lastBackup && +(o.now ?? new Date()) - +o.lastBackup < 2 * 86_400_000 ? { id: "backup_recent", ok: true } : { id: "backup_old", ok: false });
  return out;
}

/** The vault form's choice for the current storage connection, so saving the form unchanged keeps the vault. */
export function vaultChoice(con?: { provider: string; config: Record<string, unknown> }): { provider?: string; path?: string; url?: string; username?: string; notionPage?: string } {
  if (!con) return {};
  const c = con.config;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  if (con.provider === "fs") return str(c.path) ? { provider: "folder", path: str(c.path) } : { provider: "builtin" };
  if (con.provider === "webdav") return { provider: "webdav", url: str(c.url), username: str(c.username) };
  if (con.provider === "notion") return { provider: "notion", notionPage: str(c.parentPage) };
  return { provider: con.provider };
}

/** Thrown inside handlers for an expected, user-facing failure: { error: code, detail? } with status 400. */
class Fail extends Error {
  constructor(public code: string, public detail?: string, public status = 400) {
    super(code);
  }
}

const notePath = (v: unknown, fallback: string, needYear = false) => {
  const x = String(v ?? "").trim();
  return /^[^.\/][^\0]*\.md$/.test(x) && !x.includes("..") && x.length <= 300 && (!needYear || x.includes("{year}")) ? x : fallback;
};

/**
 * JSON API for the admin web app. Same rules as before: private networks only unless opened, a session cookie
 * (HttpOnly, SameSite=Strict), a CSRF token in the X-CSRF header on every change, two-factor off-network.
 */
export function adminApi(hub: Hub, opts: { vaultRoots: string[]; base: string }) {
  const B = opts.base;
  const api = new Hono<Vars>();
  const db = hub.platform.db;
  const now = () => hub.platform.now();
  const secure = (c: Context) => new URL(c.req.url).protocol === "https:";
  const actor = (c: Context<Vars>) => `admin:${c.get("adminId")}`;
  const body = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> => {
    const raw = await c.req.json().catch(() => {
      throw new Fail("invalid_json");
    });
    const r = schema.safeParse(raw);
    if (!r.success) throw new Fail("invalid_input", r.error.issues.map((i) => i.path.join(".")).join(", "));
    return r.data;
  };
  const offNetwork = (c: Context<Vars>) => !inAny(c.get("ip"), PRIVATE_CIDRS);

  api.onError((e, c) => {
    if (e instanceof Fail) return c.json({ error: e.code, detail: e.detail }, e.status as 400);
    hub.platform.log.error("admin api failed", { path: c.req.path });
    return c.json({ error: "internal" }, 500);
  });

  // ---- no session needed ----
  api.get("/session", async (c) => {
    const s = await hub.settings.get();
    const hasAdmin = await hub.admin.hasAdmin();
    const sess = hasAdmin ? await hub.admin.session(getCookie(c, SESSION_COOKIE)) : null;
    const base = { setupNeeded: !hasAdmin, language: s.admin.language, platform: hub.platform.name };
    if (!sess) return c.json({ ...base, signedIn: false });
    const totp = await hub.admin.hasTotp(sess.adminId);
    const row = await db.get<{ username: string }>(`SELECT username FROM admins WHERE id = ?`, [sess.adminId]);
    // Off-network without two-factor: only enrolment is allowed (and only in the first 24 h).
    const mustEnrol = offNetwork(c) && !totp;
    if (mustEnrol && !(await hub.admin.enrolWindowOpen(sess.adminId))) return c.json({ ...base, signedIn: false, error: "two_factor_required" });
    return c.json({ ...base, signedIn: true, csrf: sess.csrf, username: row?.username, totp, mustEnrol, onboarded: s.onboarded });
  });

  api.post("/setup", async (c) => {
    if (await hub.admin.hasAdmin()) throw new Fail("already_set_up", undefined, 409);
    const f = await body(c, z.object({ code: z.string().max(100), username: z.string().min(1).max(60), password: z.string().min(12).max(200) }));
    if (!(await hub.admin.checkSetupCode(f.code))) throw new Fail("wrong_setup_code", undefined, 403);
    const id = await hub.admin.createAdmin(f.username, f.password, `setup:${c.get("ip")}`);
    const { sid } = await hub.admin.createSession(id);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/" });
    return c.json({ ok: true });
  });

  api.post("/login", async (c) => {
    const f = await body(c, z.object({ username: z.string().max(60), password: z.string().max(200), totp: z.string().max(10).optional() }));
    const id = await hub.admin.login(f.username, f.password, f.totp || undefined, `${c.get("ip")}|${f.username}`);
    await recordAccess(db, { kind: "admin", ip: c.get("ip"), ok: !!id, who: id ? `admin:${id}` : undefined, detail: id ? undefined : `sign-in failed: ${f.username.slice(0, 40)}` }, { now: now() });
    if (!id) throw new Fail("login_failed", undefined, 401);
    if (offNetwork(c) && !(await hub.admin.hasTotp(id)) && !(await hub.admin.enrolWindowOpen(id))) throw new Fail("two_factor_required", undefined, 403);
    const { sid } = await hub.admin.createSession(id);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/" });
    return c.json({ ok: true });
  });

  // ---- everything below needs a session ----
  api.use("*", async (c, next) => {
    const sess = await hub.admin.session(getCookie(c, SESSION_COOKIE));
    if (!sess) return c.json({ error: "signed_out" }, 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!safeEqual(c.req.header("x-csrf") ?? "", sess.csrf)) return c.json({ error: "bad_csrf" }, 403);
    }
    if (offNetwork(c) && !(await hub.admin.hasTotp(sess.adminId))) {
      if (!(await hub.admin.enrolWindowOpen(sess.adminId))) return c.json({ error: "two_factor_required" }, 403);
      if (!["/totp/start", "/totp/confirm", "/logout"].includes(c.req.path.slice(c.req.path.indexOf("/api") + 4))) return c.json({ error: "enrol_first" }, 403);
    }
    c.set("adminId", sess.adminId);
    c.set("csrf", sess.csrf);
    await next();
  });

  api.post("/logout", async (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) await hub.admin.logout(sid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  api.post("/language", async (c) => {
    const f = await body(c, z.object({ language: z.enum(["auto", "en", "ko"]) }));
    const s = await hub.settings.get();
    await hub.settings.set("admin", { ...s.admin, language: f.language });
    return c.json({ ok: true });
  });

  const lastBackup = async () => (hub.platform.backups ? ((await hub.platform.backups.list())[0]?.created ?? null) : undefined);
  const checks = async (c: Context<Vars>) => {
    const s = await hub.settings.get();
    const tokens = await hub.ingestTokens.list();
    return securityChecks({
      totp: await hub.admin.hasTotp(c.get("adminId")),
      s: { ...s, admin: { ...s.admin, allowPublic: s.admin.allowPublic || hub.env.ADMIN_PUBLIC || hub.platform.name === "workers" } },
      vault: !!hub.vault,
      davTokens: tokens.filter((x) => !x.revoked_at && (JSON.parse(x.scopes) as string[]).includes("dav")).length,
      publicUrl: hub.env.PUBLIC_URL,
      lastBackup: await lastBackup(),
      now: now(),
    });
  };
  const on = (id: string) => !!hub.moduleStatus.find((m) => m.id === id)?.enabled;

  // ---- overview ----
  api.get("/overview", async (c) => {
    const s = await hub.settings.get();
    const lastOf = async (type: string) => (await db.get<{ v: string | null }>(`SELECT MAX(received_at) AS v FROM events WHERE type = ? AND (skipped IS NULL OR skipped = 'merged')`, [type]))?.v ?? null;
    const clients = (await hub.oauth.clients()).filter((x) => !x.revoked_at);
    const tokens = (await hub.ingestTokens.list()).filter((x) => !x.revoked_at);
    const conns = await db.all<{ name: string; kind: string; status: string | null; last_error: string | null; enabled: number }>(`SELECT name, kind, status, last_error, enabled FROM connections`);
    const point = on("location") ? ((await db.get<{ v: number | null }>(`SELECT MAX(t) AS v FROM location_points`))?.v ?? null) : null;
    const backup = await lastBackup();
    return c.json({
      timezone: s.timezone,
      now: now().toISOString(),
      onboarded: s.onboarded,
      vault: { connected: !!hub.vault, preset: s.wiki.preset ?? null },
      claude: { apps: clients.length, used: clients.some((x) => x.last_token_at), last: clients.map((x) => x.last_token_at).filter(Boolean).sort().at(-1) ?? null },
      payments: on("ledger") ? { last: await lastOf("ledger"), inbox: (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'`))?.n ?? 0 } : null,
      location: on("location") ? { last: point ? new Date(point * 1000).toISOString() : null, source: s.location.connection ?? null } : null,
      health: on("health") ? { last: await lastOf("health") } : null,
      devices: { tokens: tokens.length, last: tokens.map((x) => x.last_used_at).filter(Boolean).sort().at(-1) ?? null },
      backup: backup === undefined ? null : { last: backup ? backup.toISOString() : null },
      mcpAnthropicOnly: s.mcp.enforceAllow,
      totp: await hub.admin.hasTotp(c.get("adminId")),
      connectionErrors: conns.filter((x) => x.enabled && x.status === "error" && x.kind !== "storage").map((x) => ({ name: x.name, error: x.last_error })),
      moduleErrors: hub.moduleStatus.filter((m) => m.enabled && m.error).map((m) => ({ id: m.id, error: m.error })),
      otherConnections: conns.filter((x) => x.enabled && x.kind !== "storage").length,
      checks: await checks(c),
    });
  });

  // ---- vault & wiki ----
  api.get("/vault", async (c) => {
    const s = await hub.settings.get();
    const storage = await hub.connections.list("storage");
    return c.json({
      connected: !!hub.vault,
      provider: storage[0]?.provider ?? null,
      choice: vaultChoice(storage[0]),
      roots: opts.vaultRoots,
      runtime: hub.platform.name,
      dav: { enabled: s.dav.enabled, maxFileMb: s.dav.maxFileMb, available: !!storage[0] && storage[0].provider === "fs" },
      wiki: { preset: s.wiki.preset ?? null, presets: Object.keys(PRESETS), roles: s.wiki.roles, lint: effectiveRules(s.wiki.lint).map((x) => ({ id: x.rule.id, enabled: x.enabled })) },
    });
  });
  api.post("/vault", async (c) => {
    const f = await body(c, z.object({
      provider: z.enum(["builtin", "folder", "webdav", "notion", "r2"]),
      path: z.string().max(500).optional(), url: z.string().max(500).optional(), username: z.string().max(200).optional(),
      password: z.string().max(500).optional(), allowPrivateNetwork: z.boolean().optional(),
      notionPage: z.string().max(500).optional(), notionToken: z.string().max(500).optional(),
    }));
    const a = actor(c);
    if (f.provider === "notion") await hub.connections.upsert({ kind: "storage", provider: "notion", name: "vault", config: { parentPage: (f.notionPage ?? "").trim(), version: "2025-09-03" }, secrets: f.notionToken ? { token: f.notionToken } : undefined }, a);
    else if (f.provider === "r2") await hub.connections.upsert({ kind: "storage", provider: "r2", name: "vault", config: { binding: "VAULT" } }, a);
    else if (f.provider === "builtin") await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, a);
    else if (f.provider === "folder") await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: { path: f.path ?? "" } }, a);
    else await hub.connections.upsert({ kind: "storage", provider: "webdav", name: "vault", config: { url: f.url ?? "", username: f.username || undefined, allowPrivateNetwork: !!f.allowPrivateNetwork }, secrets: f.password ? { password: f.password } : undefined }, a);
    const s = await hub.settings.get();
    await hub.settings.set("vault", { ...s.vault, connection: "vault" });
    await hub.reload();
    if (!hub.vault) throw new Fail("vault_unavailable");
    try {
      await hub.vault.list(); // connection test
    } catch (e) {
      throw new Fail("vault_test_failed", (e as Error).message.slice(0, 200));
    }
    const con = await hub.connections.get("storage", "vault");
    if (con) await hub.connections.setStatus(con.id, true);
    return c.json({ ok: true });
  });
  api.post("/wiki/preset", async (c) => {
    const f = await body(c, z.object({ preset: z.string().max(40) }));
    const roles = PRESETS[f.preset];
    if (!roles) throw new Fail("unknown_preset");
    const s = await hub.settings.get();
    await hub.settings.set("wiki", { ...s.wiki, preset: f.preset, roles });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/wiki/roles", async (c) => {
    const f = await body(c, z.object({ sources: z.string().max(200), wiki: z.string().max(200), index: z.enum(["none", "folder-note", "index-file"]), indexFile: z.string().max(100), log: z.string().max(300), daily: z.string().max(300), rules: z.array(z.string().max(300)).max(50), archive: z.string().max(200) }));
    const str = (v: string) => v.trim() || undefined;
    const parsed = RolesSchema.safeParse({
      sources: str(f.sources), wiki: f.wiki.trim() === "/" ? "" : str(f.wiki),
      index: f.index === "index-file" ? { style: "index-file", file: str(f.indexFile) ?? "index.md" } : { style: f.index },
      log: str(f.log), daily: str(f.daily), rules: f.rules.map((x) => x.trim()).filter(Boolean), archive: str(f.archive),
    });
    if (!parsed.success) throw new Fail("invalid_layout");
    const s = await hub.settings.get();
    await hub.settings.set("wiki", { ...s.wiki, preset: undefined, roles: parsed.data });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/wiki/lint", async (c) => {
    const f = await body(c, z.object({ on: z.array(z.string().max(60)).max(50) }));
    const s = await hub.settings.get();
    const lint = Object.fromEntries(effectiveRules(s.wiki.lint).map((x) => [x.rule.id, { enabled: f.on.includes(x.rule.id), options: s.wiki.lint[x.rule.id]?.options }]));
    await hub.settings.set("wiki", { ...s.wiki, lint });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/dav", async (c) => {
    const f = await body(c, z.object({ enabled: z.boolean(), maxFileMb: z.number().int().min(1).max(500) }));
    await hub.settings.set("dav", f);
    await hub.reload();
    return c.json({ ok: true });
  });

  // ---- connections ----
  const findDef = (key: string) => {
    const [kind, id] = key.split(":");
    return hub.providers.find((p) => p.kind === kind && p.id === id && p.kind !== "storage");
  };
  const testConnection = async (id: string) => {
    if (!(await hub.connections.list()).some((x) => x.id === id)) throw new Fail("unknown_connection", undefined, 404);
    return hub.testConnection(id);
  };
  api.get("/connections", async (c) => {
    const rows = await db.all<{ id: string; status: string | null; last_ok_at: string | null; last_error: string | null }>(`SELECT id, status, last_ok_at, last_error FROM connections`);
    const items = (await hub.connections.list()).filter((x) => x.kind !== "storage").map((x) => {
      const st = rows.find((r) => r.id === x.id);
      return { id: x.id, kind: x.kind, name: x.name, provider: x.provider, enabled: x.enabled, status: st?.status ?? null, lastOkAt: st?.last_ok_at ?? null, lastError: st?.last_error ?? null, email: x.provider === "google" ? (x.config.email ?? null) : null };
    });
    const addable = hub.providers.filter((p) => p.kind !== "storage" && p.runtimes.includes(hub.platform.name)).map((p) => ({ key: `${p.kind}:${p.id}`, kind: p.kind, title: p.title }));
    return c.json({ items, addable });
  });
  api.get("/connections/form", async (c) => {
    const def = findDef(c.req.query("provider") ?? "");
    if (!def) throw new Fail("unknown_provider", undefined, 404);
    return c.json({
      key: `${def.kind}:${def.id}`, kind: def.kind, title: def.title,
      fields: fieldsOf(def.config), secrets: fieldsOf(def.secrets, true),
      googleRedirect: def.kind === "tasks" && def.id === "google" ? hub.google.redirectUri : null,
    });
  });
  api.post("/connections", async (c) => {
    const f = await body(c, z.object({ provider: z.string().max(80), name: z.string().regex(/^[A-Za-z0-9가-힣_-]{1,32}$/), config: z.record(z.string(), z.unknown()), secrets: z.record(z.string(), z.string().max(2000)) }));
    const def = findDef(f.provider);
    if (!def) throw new Fail("unknown_provider");
    const cfg = def.config.safeParse(Object.fromEntries(Object.entries(f.config).filter(([, v]) => v !== "" && v !== null && v !== undefined)));
    if (!cfg.success) throw new Fail("invalid_settings", cfg.error.issues.map((i) => i.path.join(".")).join(", "));
    const sec = Object.fromEntries(Object.entries(f.secrets).filter(([, v]) => v !== ""));
    // Editing an existing connection: blank secret fields keep their value; engine-filled (@internal) values are kept.
    const existing = await hub.connections.get(def.kind, f.name);
    const shape = def.config.shape as Record<string, { description?: string }>;
    const internal = existing ? Object.fromEntries(Object.keys(shape).filter((k) => shape[k]!.description === INTERNAL && existing.config[k] !== undefined).map((k) => [k, existing.config[k]])) : {};
    const secrets = existing && Object.keys(sec).length ? { ...(await hub.connections.secretsOf(existing.id)), ...sec } : sec;
    const id = await hub.connections.upsert({ kind: def.kind, provider: def.id, name: f.name, config: { ...cfg.data, ...internal }, secrets: Object.keys(secrets).length ? secrets : undefined }, actor(c));
    // A feature named after the kind (weather, calendar …) is what uses the connection: switch it on with the first one.
    const s = await hub.settings.get();
    if (hub.modules.some((m) => m.id === def.kind) && !s.modules[def.kind]?.enabled) await hub.settings.set("modules", { ...s.modules, [def.kind]: { ...s.modules[def.kind], enabled: true } });
    await hub.reload();
    return c.json({ id, test: await testConnection(id) });
  });
  api.post("/connections/:id/test", async (c) => c.json(await testConnection(c.req.param("id"))));
  api.post("/connections/:id/disable", async (c) => {
    await db.run(`UPDATE connections SET enabled = 0 WHERE id = ? AND kind != 'storage'`, [c.req.param("id")]);
    await audit(db, actor(c), "connection.disable", c.req.param("id"));
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/connections/:id/enable", async (c) => {
    await db.run(`UPDATE connections SET enabled = 1 WHERE id = ? AND kind != 'storage'`, [c.req.param("id")]);
    await audit(db, actor(c), "connection.enable", c.req.param("id"));
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/connections/:id/google", async (c) => {
    try {
      return c.json({ url: await hub.google.start(c.req.param("id")) });
    } catch (e) {
      throw new Fail("google_failed", (e as Error).message.slice(0, 200));
    }
  });

  // ---- features ----
  api.get("/features", async (c) => {
    const s = await hub.settings.get();
    const conns = (await hub.connections.list()).filter((x) => x.enabled);
    const names = (kind: string) => conns.filter((x) => x.kind === kind).map((x) => ({ name: x.name, provider: x.provider }));
    return c.json({
      modules: hub.moduleStatus,
      ledger: { ...s.ledger, available: on("ledger") },
      health: s.health,
      location: { connection: s.location.connection ?? "", geocoder: s.location.geocoder ?? "", privateAreas: s.location.privateAreas, language: s.location.language },
      notion: { connection: s.notion.connection ?? "", ledger: s.notion.ledger, health: s.notion.health },
      choices: { location: names("location"), geocoder: names("geocoder"), notion: names("notion") },
    });
  });
  api.post("/modules", async (c) => {
    const f = await body(c, z.object({ on: z.array(z.string().max(40)).max(40) }));
    await hub.settings.set("modules", Object.fromEntries(hub.moduleStatus.map((m) => [m.id, { enabled: m.id === "vault" || m.id === "hub" || f.on.includes(m.id) }])));
    await hub.reload();
    return c.json({ ok: true, modules: hub.moduleStatus });
  });
  api.post("/ledger", async (c) => {
    const f = await body(c, z.object({ officePlaces: z.array(z.string().max(60)).max(20), paymentsNote: z.string(), moneyNote: z.string(), language: z.enum(["en", "ko"]), inboxDays: z.number().int().min(1).max(365), mailSources: z.array(z.object({ connection: z.string().min(1).max(32), folder: z.string().min(1).max(200) })).max(10) }));
    const s = await hub.settings.get();
    await hub.settings.set("ledger", { ...f, officePlaces: f.officePlaces.map((x) => x.trim()).filter(Boolean), paymentsNote: notePath(f.paymentsNote, s.ledger.paymentsNote), moneyNote: notePath(f.moneyNote, s.ledger.moneyNote) });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/health", async (c) => {
    const f = await body(c, z.object({ note: z.string(), language: z.enum(["en", "ko"]) }));
    const s = await hub.settings.get();
    await hub.settings.set("health", { note: notePath(f.note, s.health.note, true), language: f.language });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/location", async (c) => {
    const f = await body(c, z.object({ connection: z.string().max(32), geocoder: z.string().max(32), privateAreas: z.array(z.string().max(60)).max(20), language: z.enum(["en", "ko"]) }));
    const s = await hub.settings.get();
    const conns = await hub.connections.list();
    const pickName = (x: string, kind: string) => (x && conns.some((n) => n.kind === kind && n.name === x) ? x : undefined);
    await hub.settings.set("location", { ...s.location, connection: pickName(f.connection, "location"), geocoder: pickName(f.geocoder, "geocoder"), privateAreas: f.privateAreas.map((x) => x.trim()).filter(Boolean), language: f.language });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/notion", async (c) => {
    const f = await body(c, z.object({ connection: z.string().max(32), ledger: z.boolean(), health: z.boolean() }));
    const s0 = await hub.settings.get();
    const conns = await hub.connections.list("notion");
    await hub.settings.set("notion", { connection: conns.some((x) => x.name === f.connection) ? f.connection : undefined, ledger: f.ledger, health: f.health });
    // Switching a kind on also turns the Notion feature on (one step instead of two).
    if (f.ledger || f.health) await hub.settings.set("modules", { ...s0.modules, notion: { enabled: true } });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/notion/sync", async (c) => {
    const a = hub.moduleAdmin.get("notion") as { sync(): Promise<{ kind: string; created: number; updated: number; unchanged: number; more: boolean }[]> } | undefined;
    try {
      return c.json({ results: a ? await a.sync() : [] });
    } catch (e) {
      throw new Fail("sync_failed", (e as Error).message.slice(0, 160));
    }
  });

  // ---- Claude ----
  api.get("/claude", async (c) => {
    const s = await hub.settings.get();
    return c.json({
      url: `${hub.env.PUBLIC_URL}/mcp`,
      clients: (await hub.oauth.clients()).map((x) => ({ id: x.client_id, name: x.client_name ?? x.client_id, createdAt: x.created_at, lastUsed: x.last_token_at ?? null, revoked: !!x.revoked_at })),
      tools: (await hub.visibleTools()).map((t) => ({ name: t.name, readOnly: !!t.readOnly, destructive: !!t.destructive })),
      toolLanguage: s.toolLanguage,
      destructive: hub.tools.filter((t) => t.destructive).map((t) => ({ name: t.name, description: t.description, enabled: s.enabledDestructive.includes(t.name) })),
    });
  });
  api.post("/claude/destructive", async (c) => {
    const f = await body(c, z.object({ name: z.string().max(64), enabled: z.boolean() }));
    if (!hub.tools.some((t) => t.destructive && t.name === f.name)) throw new Fail("invalid_input", "unknown tool");
    const s = await hub.settings.get();
    const on = new Set(s.enabledDestructive);
    if (f.enabled) on.add(f.name);
    else on.delete(f.name);
    await hub.settings.set("enabledDestructive", [...on].sort());
    await audit(db, actor(c), f.enabled ? "tool.enable" : "tool.disable", f.name);
    return c.json({ ok: true });
  });
  api.post("/claude/language", async (c) => {
    const f = await body(c, z.object({ toolLanguage: z.enum(["en", "ko", "both"]) }));
    await hub.settings.set("toolLanguage", f.toolLanguage);
    return c.json({ ok: true });
  });
  api.post("/claude/:id/revoke", async (c) => {
    await hub.oauth.revokeClient(c.req.param("id"), actor(c));
    return c.json({ ok: true });
  });

  // ---- devices ----
  api.get("/devices", async (c) =>
    c.json({ tokens: (await hub.ingestTokens.list()).map((x) => ({ id: x.id, name: x.name, scopes: JSON.parse(x.scopes) as string[], createdAt: x.created_at, lastUsed: x.last_used_at ?? null, revoked: !!x.revoked_at })), publicUrl: hub.env.PUBLIC_URL }),
  );
  api.post("/devices", async (c) => {
    const f = await body(c, z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(["ledger", "health", "location", "dav"])).min(1) }));
    const { token } = await hub.ingestTokens.create(f.name, f.scopes, actor(c));
    return c.json({ token });
  });
  api.post("/devices/:id/revoke", async (c) => {
    await hub.ingestTokens.revoke(c.req.param("id"), actor(c));
    return c.json({ ok: true });
  });

  // ---- security ----
  api.get("/security", async (c) => {
    const s = await hub.settings.get();
    return c.json({
      checks: await checks(c),
      totp: await hub.admin.hasTotp(c.get("adminId")),
      mcpAnthropicOnly: s.mcp.enforceAllow,
      allowPublic: s.admin.allowPublic,
      forcedPublic: hub.env.ADMIN_PUBLIC || hub.platform.name === "workers",
      adminUrl: `${hub.env.PUBLIC_URL}${B}`,
      protectedPaths: s.vault.protectedPaths,
      readOnly: s.vault.readOnly,
    });
  });
  api.post("/vault-safety", async (c) => {
    const glob = z.string().trim().min(1).max(200).refine((g) => !g.startsWith("/") && !g.split("/").includes(".."), "relative paths only");
    const f = await body(c, z.object({ readOnly: z.boolean(), protectedPaths: z.array(glob).max(50) }));
    const s = await hub.settings.get();
    await hub.settings.set("vault", { ...s.vault, readOnly: f.readOnly, protectedPaths: [...new Set(f.protectedPaths)] });
    await hub.reload();
    await audit(db, actor(c), "vault.safety", undefined, { readOnly: f.readOnly, protectedPaths: f.protectedPaths.length });
    return c.json({ ok: true });
  });
  api.post("/totp/start", async (c) => {
    if (await hub.admin.hasTotp(c.get("adminId"))) throw new Fail("already_on", undefined, 409);
    const secret = await hub.admin.startTotp(c.get("adminId"));
    return c.json({ secret, uri: `otpauth://totp/memexhub:admin?secret=${secret}&issuer=memexhub` });
  });
  api.post("/totp/confirm", async (c) => {
    const f = await body(c, z.object({ code: z.string().max(10) }));
    if (!(await hub.admin.confirmTotp(c.get("adminId"), f.code))) throw new Fail("wrong_code");
    return c.json({ ok: true });
  });
  api.post("/admin-public", async (c) => {
    const f = await body(c, z.object({ enable: z.boolean() }));
    if (f.enable && !(await hub.admin.hasTotp(c.get("adminId")))) throw new Fail("two_factor_first");
    const s = await hub.settings.get();
    await hub.settings.set("admin", { ...s.admin, allowPublic: f.enable });
    await audit(db, actor(c), f.enable ? "admin.open_outside" : "admin.home_only");
    return c.json({ ok: true });
  });
  api.post("/mcp-allow", async (c) => {
    const f = await body(c, z.object({ enforce: z.boolean() }));
    await hub.settings.set("mcp", { allowCidrs: ANTHROPIC_OUTBOUND_CIDRS, enforceAllow: f.enforce });
    await audit(db, actor(c), f.enforce ? "mcp.anthropic_only" : "mcp.any_address");
    return c.json({ ok: true });
  });

  // ---- activity ----
  const where = (ip: string) => (inAny(ip, PRIVATE_CIDRS) ? "home" : inAny(ip, ANTHROPIC_OUTBOUND_CIDRS) ? "anthropic" : "internet");
  api.get("/activity", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const since = new Date(+now() - days * 86_400_000).toISOString();
    if (c.req.query("view") === "changes") {
      const who = c.req.query("who") ?? "";
      const rows = await db.all<{ at: string; actor: string; action: string; target: string | null; detail: string | null }>(
        `SELECT at, actor, action, target, detail FROM audit WHERE at >= ? ${who ? "AND (actor = ? OR actor LIKE ?)" : ""} ORDER BY id DESC LIMIT 300`,
        who ? [since, who, `${who}:%`] : [since],
      );
      return c.json({ rows });
    }
    const kind = c.req.query("kind") ?? "";
    const rows = await listAccess(db, { since, kind: /^[a-z.]{1,20}$/.test(kind) ? kind : undefined, failedOnly: c.req.query("failed") === "1" });
    const names = new Map<string, string>();
    for (const x of await hub.ingestTokens.list()) names.set(x.id, x.name);
    for (const x of await hub.oauth.clients()) names.set(x.client_id, x.client_name ?? x.client_id);
    for (const x of await db.all<{ id: string; username: string }>(`SELECT id, username FROM admins`)) names.set(`admin:${x.id}`, x.username);
    return c.json({ rows: rows.map((r) => ({ ...r, ok: !!r.ok, name: r.who ? (names.get(r.who) ?? r.who) : null, where: where(r.ip) })) });
  });

  // ---- backups & import ----
  api.get("/backups", async (c) => c.json({ available: !!hub.platform.backups, list: (await hub.platform.backups?.list()) ?? [] }));
  api.post("/backups/download", async (c) => {
    const n = now();
    await audit(db, actor(c), "backup.download");
    c.header("content-disposition", `attachment; filename="memexhub-${n.toISOString().slice(0, 10)}.mxb"`);
    return c.body(await exportBackup(db, hub.platform.secret, n), 200, { "content-type": "application/octet-stream" });
  });
  const upload = async (c: Context, max: number) => {
    const f = await c.req.parseBody();
    const file = f.file;
    if (!(file instanceof File) || file.size > max) throw new Fail("choose_file");
    return { text: await file.text(), form: f };
  };
  api.post("/backups/restore", async (c) => {
    const { text, form } = await upload(c, 200 * 1024 * 1024);
    if (String(form.confirm ?? "") !== "RESTORE") throw new Fail("type_restore");
    try {
      const r = await importBackup(db, hub.platform.secret, text);
      await audit(db, actor(c), "backup.restore", undefined, { rows: r.rows, created: r.created });
      await hub.reload();
      return c.json({ rows: r.rows, created: r.created });
    } catch (e) {
      throw new Fail("restore_failed", (e as Error).message.slice(0, 200));
    }
  });
  api.post("/import/ledger", async (c) => {
    const { text } = await upload(c, 50 * 1024 * 1024);
    const r = await importLedgerLines(hub.bus, text);
    await audit(db, actor(c), "import.ledger", undefined, { added: r.added, skipped: r.skipped, invalid: r.invalid.length });
    return c.json({ added: r.added, skipped: r.skipped, invalid: r.invalid });
  });
  api.post("/import/health", async (c) => {
    const { text } = await upload(c, 50 * 1024 * 1024);
    try {
      const r = await importHealthDays(hub.bus, text);
      await audit(db, actor(c), "import.health", undefined, { added: r.added });
      return c.json({ added: r.added });
    } catch (e) {
      throw new Fail("import_failed", (e as Error).message.slice(0, 200));
    }
  });
  api.post("/import/token", async (c) => {
    const f = await body(c, z.object({ name: z.string().trim().min(1).max(40), token: z.string().trim().min(24).max(200), scopes: z.array(z.enum(["ledger", "health", "location", "dav"])).min(1) }));
    if (await hub.ingestTokens.verify(f.token, f.scopes[0]!)) throw new Fail("token_known");
    await hub.ingestTokens.importExisting(f.name, f.token, f.scopes, actor(c));
    return c.json({ ok: true });
  });

  // ---- recipes & inbox ----
  const ledger = () => {
    const a = hub.moduleAdmin.get("ledger") as LedgerAdmin | undefined;
    if (!a) throw new Fail("ledger_off", undefined, 409);
    return a;
  };
  const channel = z.enum(CHANNELS as unknown as [string, ...string[]]);
  const message = z.object({ channel: channel.default("sms"), text: z.string().min(1).max(16_000), from: z.string().max(300).optional(), subject: z.string().max(300).optional() });
  api.get("/recipes", async (c) => {
    const a = ledger();
    const [rec, inbox] = await Promise.all([a.recipes(), a.inbox()]);
    return c.json({
      dir: a.recipesDir,
      inbox: inbox.map((i) => ({ id: i.id, receivedAt: i.receivedAt, channel: i.channel, reason: i.reason, from: i.data?.message.from ?? null, subject: i.data?.message.subject ?? null, text: i.data?.message.text ?? "", guess: i.data?.guess ?? null })),
      proposed: rec.proposed.files.map((f) => ({ file: f, id: f.split("/").pop()!.replace(/\.md$/, ""), error: rec.proposed.errors.find((e) => e.path === f)?.error ?? null })),
      active: rec.active.map((r) => ({ id: r.recipe.id, name: r.recipe.name ?? r.recipe.id, kind: r.recipe.kind, channels: r.recipe.channels, path: r.path ?? null })),
      errors: rec.errors.map((e) => ({ id: e.id ?? null, path: e.path ?? null, error: e.error })),
    });
  });
  api.post("/recipes/try", async (c) => c.json(await ledger().read((await body(c, message)) as never)));
  api.post("/recipes/draft", async (c) => c.json({ json: await ledger().draft((await body(c, message)) as never) }));
  api.post("/recipes/draft-from", async (c) => {
    const f = await body(c, z.object({ id: z.string().max(80) }));
    const it = (await ledger().inbox()).find((i) => i.id === f.id);
    if (!it?.data) throw new Fail("not_pending", undefined, 404);
    const m = it.data.message;
    return c.json({ json: await ledger().draft({ channel: m.channel ?? "sms", text: m.text, from: m.from, subject: m.subject } as never), text: m.text });
  });
  const act = (fn: (a: LedgerAdmin, f: Record<string, string>) => Promise<string>, schema: z.ZodTypeAny) => async (c: Context) => {
    const a = ledger();
    try {
      return c.json({ message: await fn(a, (await body(c, schema)) as Record<string, string>) });
    } catch (e) {
      if (e instanceof Fail) throw e;
      throw new Fail("recipe_failed", (e as Error).message.slice(0, 300));
    }
  };
  api.post("/recipes/save", act((a, f) => a.saveProposal(f.json!), z.object({ json: z.string().max(50_000) })));
  api.post("/recipes/approve", act((a, f) => a.approve(f.file!), z.object({ file: z.string().max(500) })));
  api.post("/recipes/disable", act((a, f) => a.disable(f.id!), z.object({ id: z.string().max(80) })));
  api.post("/recipes/import", act((a, f) => a.importPack(f.json!), z.object({ json: z.string().max(200_000) })));
  api.get("/recipes/export", async (c) => {
    c.header("content-disposition", 'attachment; filename="memexhub-recipes.json"');
    return c.body(await ledger().exportPack(), 200, { "content-type": "application/json; charset=utf-8" });
  });
  api.post("/inbox/:id", async (c) => {
    const f = await body(c, z.object({ action: z.enum(["record", "ignore"]), merchant: z.string().max(200).optional(), amount: z.string().max(40).optional(), card: z.string().max(100).optional(), time: z.string().max(40).optional() }));
    try {
      return c.json({ message: await ledger().resolve(c.req.param("id"), f.action, { merchant: f.merchant, amount: f.amount, card: f.card, time: f.time }) });
    } catch (e) {
      throw new Fail("resolve_failed", (e as Error).message.slice(0, 300));
    }
  });

  // ---- first-run wizard ----
  api.get("/start", async (c) => {
    const s = await hub.settings.get();
    return c.json({
      timezone: s.timezone, zones: ((Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined) ?? ["UTC"],
      notes: s.ledger.language, tools: s.toolLanguage, vault: !!hub.vault, runtime: hub.platform.name,
      preset: s.wiki.preset ?? null, presets: Object.keys(PRESETS), mcpUrl: `${hub.env.PUBLIC_URL}/mcp`,
    });
  });
  api.post("/start/basics", async (c) => {
    const f = await body(c, z.object({ timezone: z.string().max(60), notes: z.enum(["en", "ko"]), tools: z.enum(["en", "ko", "both"]) }));
    const s = await hub.settings.get();
    const zones = ((Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined) ?? ["UTC"];
    await hub.settings.set("timezone", zones.includes(f.timezone) ? f.timezone : s.timezone);
    await hub.settings.set("toolLanguage", f.tools);
    await hub.settings.set("ledger", { ...s.ledger, language: f.notes });
    await hub.settings.set("health", { ...s.health, language: f.notes });
    await hub.settings.set("location", { ...s.location, language: f.notes });
    await hub.reload();
    return c.json({ ok: true });
  });
  api.post("/start/done", async (c) => {
    await hub.settings.set("onboarded", true);
    return c.json({ ok: true });
  });

  return api;
}

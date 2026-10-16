/** @jsxImportSource hono/jsx */
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import { inAny, PRIVATE_CIDRS } from "../core/ip.js";
import { safeEqual } from "../core/crypto.js";
import { securityHeaders } from "../http/common.js";
import { ANTHROPIC_OUTBOUND_CIDRS } from "../core/settings.js";
import { PRESETS, RolesSchema } from "../modules/wiki/layout.js";
import { effectiveRules } from "../modules/wiki/lint.js";
import { fieldsOf, INTERNAL, Inputs, valuesOf } from "./forms.js";
import { pick } from "../core/i18n.js";
import { recipeRoutes } from "./recipes.js";
import { wizardNext, wizardRoutes } from "./wizard.js";
import { opsRoutes } from "./ops.js";
import { recordAccess } from "../core/access.js";
import { audit } from "../core/audit.js";
import { ago, back, Check, langOf, pageFrame, tr, when, type Tr } from "./ui.js";

type Vars = { Variables: { ip: string; adminId: string; csrf: string } };
const COOKIE = "mx_admin";
const EN: Tr = (en) => en;

/** What the security page checks. Plain words; "high" ones are shown in red. */
export function securityChecks(o: { totp: boolean; s: import("../core/settings.js").Settings; vault: boolean; davTokens: number; publicUrl: string; lastBackup?: Date | null; now?: Date }, t: Tr = EN) {
  const out: { ok: boolean; level?: "high"; text: string; fix?: string }[] = [];
  out.push(
    o.totp
      ? { ok: true, text: t("Two-factor sign-in is on.", "2단계 인증이 켜져 있어요.") }
      : o.s.admin.allowPublic
        ? { ok: false, level: "high", text: t("The admin UI is open to the internet without two-factor — turn two-factor on now.", "관리 화면이 2단계 인증 없이 인터넷에 열려 있어요. 지금 2단계 인증을 켜세요."), fix: "/security" }
        : { ok: false, text: t("Two-factor sign-in is off. Turn it on below.", "2단계 인증이 꺼져 있어요. 보안 화면에서 켜세요."), fix: "/security" },
  );
  out.push(o.s.admin.allowPublic ? { ok: false, text: t("The admin UI accepts connections from the internet.", "관리 화면이 인터넷에서도 열려요.") } : { ok: true, text: t("The admin UI only answers on your private network.", "관리 화면은 집 네트워크에서만 열려요.") });
  out.push(o.s.mcp.enforceAllow ? { ok: true, text: t("Only Anthropic's servers may call /mcp.", "Anthropic 서버만 /mcp를 부를 수 있어요.") } : { ok: false, text: t("Any address may call /mcp (sign-in is still required). Restrict it to Anthropic's servers below.", "아무 주소에서나 /mcp를 부를 수 있어요(로그인은 필요). Anthropic 서버로 제한하세요."), fix: "/security" });
  if (o.publicUrl.startsWith("http://")) out.push({ ok: false, level: "high", text: t("PUBLIC_URL uses http — use https outside local testing.", "PUBLIC_URL이 http예요. 로컬 시험이 아니면 https를 쓰세요.") });
  if (!o.vault) out.push({ ok: false, text: t("No vault is connected yet.", "아직 볼트가 연결되지 않았어요."), fix: "/vault" });
  if (o.s.dav.enabled) out.push(o.davTokens ? { ok: true, text: t(`Vault sync (WebDAV) is on for ${o.davTokens} device(s).`, `볼트 동기화(WebDAV)를 기기 ${o.davTokens}대가 써요.`) } : { ok: false, text: t("Vault sync (WebDAV) is on but no device has a token yet.", "볼트 동기화(WebDAV)가 켜져 있지만 토큰이 있는 기기가 없어요."), fix: "/devices" });
  if (o.s.vault.readOnly) out.push({ ok: true, text: t("The vault is read-only for Claude.", "Claude에게 볼트는 읽기 전용이에요.") });
  if (o.lastBackup !== undefined)
    out.push(o.lastBackup && +(o.now ?? new Date()) - +o.lastBackup < 2 * 86_400_000 ? { ok: true, text: t("A backup was made in the last two days.", "최근 이틀 안에 백업이 있어요.") } : { ok: false, text: t("No recent backup — see Backups.", "최근 백업이 없어요. 백업 화면을 보세요."), fix: "/backups" });
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

const MODULE_NAMES: Record<string, [string, string, string, string]> = {
  vault: ["Vault", "볼트", "read and write notes", "노트 읽기·쓰기"],
  wiki: ["Wiki", "위키", "keeps the wiki tidy: index, links, log", "색인·링크·기록으로 위키 정리"],
  ledger: ["Payments", "결제", "card messages, wallet and receipt mails → payment notes", "카드 문자·지갑·영수증 메일 → 결제 노트"],
  mail: ["Mail", "메일", "Claude reads your mailbox (read-only)", "Claude가 메일함을 읽기 (읽기 전용)"],
  location: ["Location", "위치", "where you were, place names for payments", "다녀온 곳, 결제 장소 이름"],
  health: ["Health", "건강", "sleep, steps and workouts → health notes", "수면·걸음·운동 → 건강 노트"],
  tasks: ["Tasks", "할 일", "Google Tasks for Claude", "Claude가 Google Tasks 사용"],
  notion: ["Notion", "Notion", "copy records into Notion databases", "기록을 Notion 데이터베이스로 복사"],
  hub: ["Summaries", "요약", "day and week summaries, status", "하루·한 주 요약, 상태"],
};
const SCOPES: [string, string, string][] = [
  ["ledger", "Payments", "결제"],
  ["health", "Health", "건강"],
  ["location", "Location", "위치"],
  ["dav", "Vault sync (WebDAV)", "볼트 동기화 (WebDAV)"],
];
const KIND_NAMES: Record<string, [string, string]> = {
  storage: ["Vault", "볼트"], mail: ["Mail", "메일"], location: ["Location", "위치"], geocoder: ["Place names", "지명"], tasks: ["Tasks", "할 일"], notion: ["Notion", "Notion"],
};
const kindName = (t: Tr, k: string) => t(...(KIND_NAMES[k] ?? [k, k]));
const scopeName = (t: Tr, s: string) => {
  const x = SCOPES.find((y) => y[0] === s);
  return x ? t(x[1], x[2]) : s;
};

/** Admin surface. Private networks only unless explicitly opened (and then TOTP is required). */
export function adminApp(hub: Hub, opts: { vaultRoots: string[]; builtinVault: string; base?: string }) {
  /** Mount prefix ("" on its own port, "/admin" in LISTEN=single). Every link, form and redirect uses it. */
  const B = (opts.base ?? "").replace(/\/+$/, "");
  const R = B || "/"; // the overview
  // strict: false — "/admin" and "/admin/" are the same page when mounted under a prefix.
  const app = new Hono<Vars>({ strict: false });
  const frame = pageFrame(hub, B);
  const T = async (c: Context) => tr(await langOf(hub, c));
  app.use("*", securityHeaders);

  app.use("*", async (c, next) => {
    const s = await hub.settings.get();
    // Cloudflare Workers has no private network: there the admin UI is always reached over the internet (two-factor enforced below).
    if (!s.admin.allowPublic && !hub.env.ADMIN_PUBLIC && hub.platform.name !== "workers" && !inAny(c.get("ip"), PRIVATE_CIDRS)) return c.text("admin is only available from your private network", 403);
    await next();
  });

  const secure = (c: Context) => new URL(c.req.url).protocol === "https:";
  const startSession = async (c: Context, adminId: string) => {
    const { sid } = await hub.admin.createSession(adminId);
    setCookie(c, COOKIE, sid, { httpOnly: true, sameSite: "Strict", secure: secure(c), path: "/" });
  };
  /** A plain page outside the signed-in frame (sign-in, setup, two-factor). */
  const bare = async (c: Context, title: string, body: any) => c.html(<Layout title={`${title} · memexhub`} lang={await langOf(hub, c)}>{body}</Layout>);

  // ---- first run ----
  app.get("/setup", async (c) => {
    if (await hub.admin.hasAdmin()) return c.redirect(`${B}/login`);
    const t = await T(c);
    return bare(c, t("Set up memexhub", "memexhub 설정"), (
      <div class="card">
        <h1>{t("Set up memexhub", "memexhub 설정")}</h1>
        <p class="muted">{t("Enter the one-time setup code printed in the server log, then create the admin account.", "서버 로그에 찍힌 일회용 설정 코드를 넣고 관리자 계정을 만드세요.")}</p>
        <form method="post">
          <label>{t("Setup code", "설정 코드")}<input name="code" required autocomplete="off" /></label>
          <label>{t("Admin username", "관리자 아이디")}<input name="username" required autocomplete="username" /></label>
          <label>{t("Password (12+ characters)", "비밀번호 (12자 이상)")}<input name="password" type="password" minlength={12} required autocomplete="new-password" /></label>
          <button>{t("Create admin", "관리자 만들기")}</button>
        </form>
      </div>
    ));
  });
  app.post("/setup", async (c) => {
    if (await hub.admin.hasAdmin()) return c.redirect(`${B}/login`);
    const f = await c.req.parseBody();
    if (!(await hub.admin.checkSetupCode(String(f.code ?? "")))) return c.text("wrong setup code", 403);
    try {
      const id = await hub.admin.createAdmin(String(f.username), String(f.password), `setup:${c.get("ip")}`);
      await startSession(c, id);
      return c.redirect(`${B}/start`);
    } catch (e) {
      return c.text((e as Error).message, 400);
    }
  });

  app.get("/login", async (c) => {
    const t = await T(c);
    return bare(c, t("Sign in", "로그인"), (
      <div class="card">
        <h1>memexhub</h1>
        <form method="post">
          <label>{t("Username", "아이디")}<input name="username" autocomplete="username" required /></label>
          <label>{t("Password", "비밀번호")}<input name="password" type="password" autocomplete="current-password" required /></label>
          <label>{t("Authenticator code", "인증 앱 코드")}<span class="hint">{t("Only if two-factor is on.", "2단계 인증을 켠 경우에만.")}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code" /></label>
          <button>{t("Sign in", "로그인")}</button>
        </form>
      </div>
    ));
  });
  app.post("/login", async (c) => {
    const f = await c.req.parseBody();
    const id = await hub.admin.login(String(f.username ?? ""), String(f.password ?? ""), String(f.totp ?? "") || undefined, `${c.get("ip")}|${f.username}`);
    await recordAccess(hub.platform.db, { kind: "admin", ip: c.get("ip"), ok: !!id, who: id ? `admin:${id}` : undefined, detail: id ? undefined : `sign-in failed: ${String(f.username ?? "").slice(0, 40)}` }, { now: hub.platform.now() });
    if (!id) return c.text("login failed", 401);
    if (!inAny(c.get("ip"), PRIVATE_CIDRS) && !(await hub.admin.hasTotp(id)) && !(await hub.admin.enrolWindowOpen(id)))
      return c.text("Two-factor sign-in is required from outside your private network. Sign in from your network and turn it on first.", 403);
    await startSession(c, id);
    return c.redirect(R);
  });

  // ---- everything below needs a session ----
  app.use("*", async (c, next) => {
    if (!(await hub.admin.hasAdmin())) return c.redirect(`${B}/setup`);
    const sess = await hub.admin.session(getCookie(c, COOKIE));
    if (!sess) return c.redirect(`${B}/login`);
    if (c.req.method === "POST") {
      const f = await c.req.parseBody();
      if (!safeEqual(String(f.csrf ?? ""), sess.csrf)) return c.text("bad csrf token", 403);
    }
    if (!inAny(c.get("ip"), PRIVATE_CIDRS) && !(await hub.admin.hasTotp(sess.adminId))) {
      // Off-network without two-factor: only enrolment, within 24 h of creating the account.
      if (!(await hub.admin.enrolWindowOpen(sess.adminId))) return c.text("Two-factor sign-in is required from outside your private network.", 403);
      const path = new URL(c.req.url).pathname.slice(B.length) || "/";
      if (!["/two-factor", "/totp", "/totp/confirm", "/logout"].includes(path)) return c.redirect(`${B}/two-factor`);
    }
    c.set("adminId", sess.adminId);
    c.set("csrf", sess.csrf);
    await next();
  });
  const actor = (c: Context<Vars>) => `admin:${c.get("adminId")}`;
  const Csrf = (p: { c: Context<Vars> }) => <input type="hidden" name="csrf" value={p.c.get("csrf")} />;
  recipeRoutes(app, hub, Csrf, B);
  wizardRoutes(app, hub, Csrf, B);
  opsRoutes(app, hub, Csrf, B);

  const checksFor = async (c: Context<Vars>, t: Tr) => {
    const s = await hub.settings.get();
    const tokens = await hub.ingestTokens.list();
    const lastBackup = hub.platform.backups ? ((await hub.platform.backups.list())[0]?.created ?? null) : undefined;
    return securityChecks(
      {
        totp: await hub.admin.hasTotp(c.get("adminId")),
        s: { ...s, admin: { ...s.admin, allowPublic: s.admin.allowPublic || hub.env.ADMIN_PUBLIC || hub.platform.name === "workers" } },
        vault: !!hub.vault,
        davTokens: tokens.filter((x) => !x.revoked_at && (JSON.parse(x.scopes) as string[]).includes("dav")).length,
        publicUrl: hub.env.PUBLIC_URL,
        lastBackup,
        now: hub.platform.now(),
      },
      t,
    );
  };

  /** Switch the admin UI language (GET from the header link; only this setting, nothing else). */
  app.get("/lang", async (c) => {
    const to = c.req.query("to");
    const s = await hub.settings.get();
    if (to === "en" || to === "ko") await hub.settings.set("admin", { ...s.admin, language: to });
    return c.redirect(R);
  });

  // ---- overview ----
  app.get("/", async (c) => {
    const s = await hub.settings.get();
    const db = hub.platform.db;
    const now = hub.platform.now();
    const tz = s.timezone;
    const t = await T(c);
    const on = (id: string) => !!hub.moduleStatus.find((m) => m.id === id)?.enabled;
    const lastOf = async (type: string) => (await db.get<{ v: string | null }>(`SELECT MAX(received_at) AS v FROM events WHERE type = ? AND (skipped IS NULL OR skipped = 'merged')`, [type]))?.v ?? null;
    const lastPayment = on("ledger") ? await lastOf("ledger") : null;
    const lastHealth = on("health") ? await lastOf("health") : null;
    const lastPoint = on("location") ? ((await db.get<{ v: number | null }>(`SELECT MAX(t) AS v FROM location_points`))?.v ?? null) : null;
    const inbox = on("ledger") ? ((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'`))?.n ?? 0) : 0;
    const clients = (await hub.oauth.clients()).filter((x) => !x.revoked_at);
    const lastClaude = clients.map((x) => x.last_token_at).filter(Boolean).sort().at(-1) ?? null;
    const tokens = (await hub.ingestTokens.list()).filter((x) => !x.revoked_at);
    const lastDevice = tokens.map((x) => x.last_used_at).filter(Boolean).sort().at(-1) ?? null;
    const conns = await db.all<{ name: string; status: string | null; last_error: string | null; enabled: number }>(`SELECT name, status, last_error, enabled FROM connections`);
    const lastBackup = hub.platform.backups ? ((await hub.platform.backups.list())[0]?.created ?? null) : undefined;
    const attention: { text: string; fix?: string; high?: boolean }[] = [];
    for (const x of conns.filter((x) => x.enabled && x.status === "error")) attention.push({ text: t(`Connection "${x.name}" failed: ${x.last_error ?? ""}`, `연결 "${x.name}" 오류: ${x.last_error ?? ""}`), fix: "/connections" });
    for (const m of hub.moduleStatus.filter((m) => m.enabled && m.error)) attention.push({ text: `${t(MODULE_NAMES[m.id]?.[0] ?? m.id, MODULE_NAMES[m.id]?.[1] ?? m.id)}: ${m.error}`, fix: "/features" });
    if (inbox) attention.push({ text: t(`${inbox} message(s) could not be read and wait in the inbox.`, `읽지 못한 메시지 ${inbox}개가 대기함에 있어요.`), fix: "/ledger/recipes" });
    for (const x of (await checksFor(c, t)).filter((x) => !x.ok)) attention.push({ text: x.text, fix: x.fix, high: x.level === "high" });
    const Stat = (p: { href: string; k: string; v: string; s?: string; ok?: boolean }) => (
      <a class="card stat" href={`${B}${p.href}`}>
        <div class="k">{p.k}</div>
        <div class="v">{p.ok === undefined ? null : <span class={`dot ${p.ok ? "ok" : "err"}`} />}{p.v}</div>
        {p.s ? <div class="s">{p.s}</div> : null}
      </a>
    );
    return frame(c, {
      title: ["Overview", "개요"],
      active: "/",
      children: (t) => (
        <>
          <h1>{t("Overview", "개요")}</h1>
          {!s.onboarded && (
            <div class="card"><p><b>{t("Finish setting up", "설정 마치기")}</b> — {t("time zone, vault, wiki layout and the Claude connector, one step at a time.", "시간대, 볼트, 위키 구조, Claude 커넥터를 한 단계씩.")}</p><a class="btn" href={`${B}/start`}>{t("Continue setup", "설정 계속하기")}</a></div>
          )}
          <div class="grid">
            <Stat href="/vault" k={t("Vault", "볼트")} ok={!!hub.vault} v={hub.vault ? t("Connected", "연결됨") : t("Not connected", "연결 안 됨")} s={hub.vault ? (s.wiki.preset ?? t("custom layout", "직접 정한 구조")) : t("Connect one first", "먼저 연결하세요")} />
            <Stat href="/claude" k="Claude" v={clients.length ? t(`Last used ${ago(t, lastClaude, now, tz)}`, `마지막 사용 ${ago(t, lastClaude, now, tz)}`) : t("Not connected yet", "아직 연결 안 됨")} s={t(`${clients.length} app(s) signed in`, `앱 ${clients.length}개 로그인`)} />
            {on("ledger") && <Stat href="/ledger/recipes" k={t("Payments", "결제")} v={t(`Last ${ago(t, lastPayment, now, tz)}`, `마지막 ${ago(t, lastPayment, now, tz)}`)} s={inbox ? t(`${inbox} in the inbox`, `대기함 ${inbox}개`) : t("Inbox empty", "대기함 비어 있음")} />}
            {on("location") && <Stat href="/features#location" k={t("Location", "위치")} ok={!!lastPoint && +now / 1000 - lastPoint < 6 * 3600} v={t(`Last point ${ago(t, lastPoint ? lastPoint * 1000 : null, now, tz)}`, `마지막 위치 ${ago(t, lastPoint ? lastPoint * 1000 : null, now, tz)}`)} s={s.location.connection ?? ""} />}
            {on("health") && <Stat href="/features#health" k={t("Health", "건강")} v={t(`Last ${ago(t, lastHealth, now, tz)}`, `마지막 ${ago(t, lastHealth, now, tz)}`)} />}
            <Stat href="/devices" k={t("Devices", "기기")} v={t(`Last sent ${ago(t, lastDevice, now, tz)}`, `마지막 수신 ${ago(t, lastDevice, now, tz)}`)} s={t(`${tokens.length} token(s)`, `토큰 ${tokens.length}개`)} />
            {lastBackup !== undefined && <Stat href="/backups" k={t("Backup", "백업")} ok={!!lastBackup && +now - +lastBackup < 2 * 86_400_000} v={ago(t, lastBackup, now, tz)} />}
          </div>
          <div class="card">
            <h2>{t("Needs attention", "확인할 것")}</h2>
            {attention.length ? (
              <ul class="list">{attention.map((x) => <li><span class={`dot ${x.high ? "err" : ""}`} /><span>{x.text} {x.fix ? <a href={`${B}${x.fix}`}>{t("Open", "열기")} →</a> : null}</span></li>)}</ul>
            ) : <p class="ok">{t("All good.", "모두 괜찮아요.")}</p>}
          </div>
          <p class="muted">{t("Time zone", "시간대")} {tz} · {when(now, tz)}</p>
        </>
      ),
    });
  });

  // ---- vault & wiki ----
  app.get("/vault", async (c) => {
    const s = await hub.settings.get();
    const storage = await hub.connections.list("storage");
    const cur = vaultChoice(storage[0]);
    return frame(c, {
      title: ["Vault", "볼트"],
      active: "/vault",
      children: (t) => (
        <>
          <h1>{t("Vault", "볼트")}</h1>
          <div class="card">
            <h2>{t("Where your notes live", "노트가 있는 곳")}</h2>
            <p>{hub.vault ? <><span class="dot ok" />{t("Connected", "연결됨")} <span class="muted">{storage[0]?.provider}{cur.path ? ` · ${cur.path}` : ""}{cur.url ? ` · ${cur.url}` : ""}</span></> : <><span class="dot err" />{t("Not connected", "연결 안 됨")}</>}</p>
            <details open={!hub.vault}>
              <summary>{hub.vault ? t("Change the vault", "볼트 바꾸기") : t("Connect a vault", "볼트 연결하기")}</summary>
              <form method="post" action={`${B}/vault`}>
                <Csrf c={c} />
                <label>{t("Kind", "종류")}
                  <select name="provider">
                    {hub.platform.name === "workers" ? (
                      <option value="r2" selected={cur.provider === "r2"}>{t("The R2 bucket of this Worker (recommended)", "이 Worker의 R2 버킷 (추천)")}</option>
                    ) : (
                      <>
                        <option value="builtin" selected={cur.provider === "builtin"}>{t("Create on this server (recommended)", "이 서버에 만들기 (추천)")}</option>
                        <option value="folder" selected={cur.provider === "folder"}>{t("Existing folder on this server", "이 서버의 기존 폴더")}</option>
                      </>
                    )}
                    <option value="webdav" selected={cur.provider === "webdav"}>WebDAV</option>
                    <option value="notion" selected={cur.provider === "notion"}>{t("Notion (beta — small vaults)", "Notion (베타, 작은 볼트)")}</option>
                  </select>
                </label>
                <label class="vf vf-folder">{t("Folder", "폴더")}<span class="hint">{t(`Under ${opts.vaultRoots.join(" or ")}`, `${opts.vaultRoots.join(" 또는 ")} 아래`)}</span><input name="path" value={cur.path ?? ""} placeholder={`${opts.vaultRoots[0] ?? ""}/my-vault`} /></label>
                <div class="vf vf-webdav">
                  <label>WebDAV URL<input name="url" value={cur.url ?? ""} placeholder="https://dav.example.com/vault" /></label>
                  <label>{t("Username", "아이디")}<input name="username" value={cur.username ?? ""} autocomplete="off" /></label>
                  <label>{t("Password", "비밀번호")}<span class="hint">{t("Stored encrypted, never shown again. Leave empty to keep.", "암호화해 저장하고 다시 보여주지 않아요. 비우면 그대로 둬요.")}</span><input name="password" type="password" autocomplete="new-password" /></label>
                  <Check name="allowPrivateNetwork">{t("The WebDAV server is on my private network", "WebDAV 서버가 집 네트워크에 있어요")}</Check>
                </div>
                <div class="vf vf-notion">
                  <label>{t("Notion page for the vault", "볼트로 쓸 Notion 페이지")}<span class="hint">{t("Share it with your integration first.", "먼저 통합(integration)과 공유하세요.")}</span><input name="notionPage" value={cur.notionPage ?? ""} placeholder="https://www.notion.so/…" /></label>
                  <label>{t("Integration secret", "통합 비밀값")}<span class="hint">{t("Stored encrypted. Leave empty to keep.", "암호화해 저장해요. 비우면 그대로 둬요.")}</span><input name="notionToken" type="password" autocomplete="new-password" /></label>
                </div>
                <button>{t("Save and test", "저장하고 시험")}</button>
              </form>
            </details>
          </div>

          <div class="card" id="sync">
            <h2>{t("Sync with Obsidian on your devices", "기기의 Obsidian과 동기화")}</h2>
            {storage[0] && ["fs"].includes(storage[0].provider) ? (
              <form method="post" action={`${B}/dav`}>
                <Csrf c={c} />
                <Check name="enabled" checked={s.dav.enabled}>{t("Serve this vault over WebDAV at /dav/", "이 볼트를 /dav/ 에서 WebDAV로 열기")}</Check>
                <label>{t("Largest file (MB)", "가장 큰 파일 (MB)")}<input name="maxFileMb" type="number" min="1" max="500" value={String(s.dav.maxFileMb)} /></label>
                <button>{t("Save", "저장")}</button>
                <p class="muted">{t("In Obsidian install Remotely Save → WebDAV: address https://<your address>/dav/, any username, and as password a device token that may send “Vault sync” (Devices). Deleted files go to .trash.", "Obsidian에서 Remotely Save → WebDAV: 주소 https://<내 주소>/dav/, 아이디는 아무거나, 비밀번호는 “볼트 동기화” 권한의 기기 토큰(기기 화면). 지운 파일은 .trash로 가요.")}</p>
              </form>
            ) : <p class="muted">{t("Available when the vault lives on this server (built-in or a folder).", "볼트가 이 서버에 있을 때(기본 또는 폴더) 쓸 수 있어요.")}</p>}
          </div>

          <div class="card" id="wiki">
            <h2>{t("Wiki layout", "위키 구조")}</h2>
            <p class="muted">{t("memexhub knows roles, not folder names. Pick a preset, then adjust.", "memexhub는 폴더 이름이 아니라 역할을 알아요. 프리셋을 고른 뒤 고치세요.")}</p>
            <form method="post" action={`${B}/wiki/preset`} class="row">
              <Csrf c={c} />
              <select name="preset" style="flex:1;min-width:10rem;margin:0" aria-label={t("Preset", "프리셋")}>
                {Object.keys(PRESETS).map((p) => <option value={p} selected={s.wiki.preset === p}>{p}</option>)}
              </select>
              <button class="secondary">{t("Apply preset", "프리셋 적용")}</button>
            </form>
            <details>
              <summary>{t("Folders for each role", "역할별 폴더")}</summary>
              <form method="post" action={`${B}/wiki/roles`}>
                <Csrf c={c} />
                <label>{t("Sources folder (write-once)", "원본 폴더 (한 번만 쓰기)")}<input name="sources" value={s.wiki.roles.sources ?? ""} placeholder="raw" /></label>
                <label>{t("Wiki folder", "위키 폴더")}<span class="hint">{t('Empty = off, "/" = whole vault.', '비우면 끔, "/"는 볼트 전체.')}</span><input name="wiki" value={s.wiki.roles.wiki === "" ? "/" : s.wiki.roles.wiki ?? ""} /></label>
                <label>{t("Index style", "색인 방식")}
                  <select name="index">
                    {(["none", "folder-note", "index-file"] as const).map((x) => <option value={x} selected={s.wiki.roles.index.style === x}>{x}</option>)}
                  </select>
                </label>
                <label>{t("Index file name (for index-file)", "색인 파일 이름 (index-file일 때)")}<input name="indexFile" value={s.wiki.roles.index.style === "index-file" ? s.wiki.roles.index.file : "index.md"} /></label>
                <label>{t("Log note", "기록 노트")}<input name="log" value={s.wiki.roles.log ?? ""} /></label>
                <label>{t("Daily notes pattern", "일일 노트 패턴")}<input name="daily" value={s.wiki.roles.daily ?? ""} placeholder="Journal/{YYYY-MM-DD}.md" /></label>
                <label>{t("Protected rule notes", "보호할 규칙 노트")}<span class="hint">{t("Comma-separated globs. Claude cannot change these.", "쉼표로 구분한 패턴. Claude가 못 고쳐요.")}</span><input name="rules" value={s.wiki.roles.rules.join(", ")} /></label>
                <label>{t("Archive folder", "보관 폴더")}<input name="archive" value={s.wiki.roles.archive ?? ""} /></label>
                <button>{t("Save layout", "구조 저장")}</button>
              </form>
            </details>
            <details>
              <summary>{t("Wiki checks", "위키 점검 규칙")}</summary>
              <form method="post" action={`${B}/wiki/lint`}>
                <Csrf c={c} />
                {effectiveRules(s.wiki.lint).map((x) => <Check name="on" value={x.rule.id} checked={x.enabled}>{x.rule.id}</Check>)}
                <button>{t("Save checks", "점검 규칙 저장")}</button>
              </form>
            </details>
          </div>
        </>
      ),
    });
  });

  app.post("/vault", async (c) => {
    const f = await c.req.parseBody();
    const t = await T(c);
    const provider = String(f.provider);
    try {
      if (provider === "notion") {
        await hub.connections.upsert(
          { kind: "storage", provider: "notion", name: "vault", config: { parentPage: String(f.notionPage ?? "").trim(), version: "2025-09-03" }, secrets: f.notionToken ? { token: String(f.notionToken) } : undefined },
          actor(c),
        );
      } else if (provider === "r2") {
        await hub.connections.upsert({ kind: "storage", provider: "r2", name: "vault", config: { binding: "VAULT" } }, actor(c));
      } else if (provider === "builtin") {
        await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, actor(c));
      } else if (provider === "folder") {
        await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: { path: String(f.path ?? "") } }, actor(c));
      } else if (provider === "webdav") {
        await hub.connections.upsert(
          { kind: "storage", provider: "webdav", name: "vault", config: { url: String(f.url), username: String(f.username ?? "") || undefined, allowPrivateNetwork: f.allowPrivateNetwork === "on" }, secrets: f.password ? { password: String(f.password) } : undefined },
          actor(c),
        );
      } else return c.text("unknown provider", 400);
      const s = await hub.settings.get();
      await hub.settings.set("vault", { ...s.vault, connection: "vault" });
      await hub.reload();
      if (!hub.vault) return back(c, B, "/vault", { err: t("Saved, but the vault could not be opened — check the path or credentials.", "저장했지만 볼트를 열 수 없어요. 경로나 계정을 확인하세요.") });
      await hub.vault.list(); // connection test
      const con = await hub.connections.get("storage", "vault");
      if (con) await hub.connections.setStatus(con.id, true);
      const next = wizardNext(B, f.next);
      return next ? c.redirect(next) : back(c, B, "/vault", { ok: t("Vault connected.", "볼트를 연결했어요.") });
    } catch (e) {
      return back(c, B, "/vault", { err: t(`Vault test failed: ${(e as Error).message}`, `볼트 시험 실패: ${(e as Error).message}`) });
    }
  });

  app.post("/wiki/preset", async (c) => {
    const f = await c.req.parseBody();
    const t = await T(c);
    const name = String(f.preset);
    const roles = PRESETS[name];
    if (!roles) return c.text("unknown preset", 400);
    const s = await hub.settings.get();
    await hub.settings.set("wiki", { ...s.wiki, preset: name, roles });
    await hub.reload();
    const next = wizardNext(B, f.next);
    return next ? c.redirect(next) : back(c, B, "/vault", { ok: t(`Layout "${name}" applied.`, `"${name}" 구조를 적용했어요.`) });
  });
  app.post("/wiki/lint", async (c) => {
    const f = await c.req.parseBody({ all: true });
    const on = new Set([f.on].flat().filter(Boolean).map(String));
    const s = await hub.settings.get();
    const lint = Object.fromEntries(effectiveRules(s.wiki.lint).map((x) => [x.rule.id, { enabled: on.has(x.rule.id), options: s.wiki.lint[x.rule.id]?.options }]));
    await hub.settings.set("wiki", { ...s.wiki, lint });
    await hub.reload();
    return back(c, B, "/vault", { ok: (await T(c))("Saved.", "저장했어요.") });
  });
  app.post("/wiki/roles", async (c) => {
    const f = await c.req.parseBody();
    const t = await T(c);
    const str = (k: string) => (String(f[k] ?? "").trim() || undefined);
    const wiki = String(f.wiki ?? "").trim();
    const parsed = RolesSchema.safeParse({
      sources: str("sources"),
      wiki: wiki === "/" ? "" : wiki || undefined,
      index: f.index === "index-file" ? { style: "index-file", file: str("indexFile") ?? "index.md" } : { style: f.index === "folder-note" ? "folder-note" : "none" },
      log: str("log"),
      daily: str("daily"),
      rules: String(f.rules ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      archive: str("archive"),
    });
    if (!parsed.success) return back(c, B, "/vault", { err: t("That layout is not valid. Check the folder names.", "구조가 올바르지 않아요. 폴더 이름을 확인하세요.") });
    const s = await hub.settings.get();
    await hub.settings.set("wiki", { ...s.wiki, preset: undefined, roles: parsed.data });
    await hub.reload();
    return back(c, B, "/vault", { ok: t("Layout saved.", "구조를 저장했어요.") });
  });
  app.post("/dav", async (c) => {
    const f = await c.req.parseBody();
    await hub.settings.set("dav", { enabled: f.enabled === "on", maxFileMb: Math.min(500, Math.max(1, Number(f.maxFileMb) || 50)) });
    await hub.reload();
    return back(c, B, "/vault", { ok: (await T(c))("Saved.", "저장했어요.") });
  });

  // ---- connections ----
  const findDef = (key: string) => {
    const [kind, id] = key.split(":");
    return hub.providers.find((p) => p.kind === kind && p.id === id && p.kind !== "storage");
  };
  app.get("/connections", async (c) => {
    const s = await hub.settings.get();
    const lang = await langOf(hub, c);
    const now = hub.platform.now();
    const others = (await hub.connections.list()).filter((x) => x.kind !== "storage");
    const rows = await hub.platform.db.all<{ id: string; status: string | null; last_ok_at: string | null; last_error: string | null }>(`SELECT id, status, last_ok_at, last_error FROM connections`);
    const statusOf = (id: string) => rows.find((r) => r.id === id);
    const addable = hub.providers.filter((p) => p.kind !== "storage" && p.runtimes.includes(hub.platform.name));
    return frame(c, {
      title: ["Connections", "연결"],
      active: "/connections",
      children: (t) => (
        <>
          <h1>{t("Connections", "연결")}</h1>
          <p class="muted">{t("Outside services memexhub reads from. Secrets are stored encrypted and never shown again.", "memexhub가 읽어 오는 바깥 서비스예요. 비밀값은 암호화해 저장하고 다시 보여주지 않아요.")}</p>
          <div class="card">
            {others.length ? (
              <ul class="list">
                {others.map((x) => {
                  const st = statusOf(x.id);
                  const state = !x.enabled ? "" : st?.status === "ok" ? "ok" : st?.status === "error" ? "err" : "";
                  return (
                    <li style="flex-wrap:wrap">
                      <span class={`dot ${state}`} />
                      <span style="flex:1;min-width:12rem">
                        <b>{x.name}</b> <span class="tag">{kindName(t, x.kind)}</span><span class="tag">{x.provider}</span>
                        <span class="hint">{!x.enabled ? t("Off", "꺼짐") : st?.status === "ok" ? t(`Working · checked ${ago(t, st.last_ok_at, now, s.timezone)}`, `정상 · ${ago(t, st.last_ok_at, now, s.timezone)} 확인`) : st?.status === "error" ? <span class="err">{st.last_error}</span> : t("Not tested yet", "아직 시험 안 함")}</span>
                        {x.provider === "google" && x.config.email ? <span class="hint">{String(x.config.email)}</span> : null}
                      </span>
                      <span class="row">
                        {x.provider === "google" && <form method="post" action={`${B}/connections/${x.id}/google`} class="inline"><Csrf c={c} /><button class="small">{x.config.email ? t("Sign in again", "다시 로그인") : t("Sign in with Google", "Google로 로그인")}</button></form>}
                        <form method="post" action={`${B}/connections/${x.id}/test`} class="inline"><Csrf c={c} /><button class="secondary small">{t("Test", "시험")}</button></form>
                        {x.enabled ? <form method="post" action={`${B}/connections/${x.id}/disable`} class="inline"><Csrf c={c} /><button class="secondary small">{t("Turn off", "끄기")}</button></form> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p class="muted">{t("No connections yet.", "아직 연결이 없어요.")}</p>}
          </div>
          {addable.length ? (
            <div class="card">
              <h2>{t("Add a connection", "연결 추가")}</h2>
              <form method="get" action={`${B}/connections/new`} class="row">
                <select name="provider" style="flex:1;min-width:12rem;margin:0" aria-label={t("Service", "서비스")}>{addable.map((p) => <option value={`${p.kind}:${p.id}`}>{kindName(t, p.kind)} — {pick(p.title, lang)}</option>)}</select>
                <button>{t("Next", "다음")}</button>
              </form>
            </div>
          ) : null}
        </>
      ),
    });
  });
  app.get("/connections/new", async (c) => {
    const def = findDef(String(c.req.query("provider") ?? ""));
    if (!def) return c.text("unknown provider", 400);
    const lang = await langOf(hub, c);
    return frame(c, {
      title: ["Add connection", "연결 추가"],
      active: "/connections",
      children: (t) => (
        <>
          <p><a href={`${B}/connections`}>← {t("Connections", "연결")}</a></p>
          <h1>{kindName(t, def.kind)}: {pick(def.title, lang)}</h1>
          <div class="card">
            <form method="post" action={`${B}/connections`}>
              <Csrf c={c} />
              <input type="hidden" name="provider" value={`${def.kind}:${def.id}`} />
              <label>{t("Name", "이름")} *<span class="hint">{t("e.g. personal, work", "예: personal, work")}</span><input name="name" required pattern="[A-Za-z0-9가-힣_-]{1,32}" /></label>
              <Inputs fields={fieldsOf(def.config)} prefix="config" />
              <Inputs fields={fieldsOf(def.secrets, true)} prefix="secret" />
              {def.kind === "tasks" && def.id === "google" && (
                <p class="muted">{t("In Google Cloud, create an OAuth client of type Web application, enable the Google Tasks API, and add this authorized redirect URI:", "Google Cloud에서 웹 애플리케이션 유형의 OAuth 클라이언트를 만들고 Google Tasks API를 켠 뒤, 승인된 리디렉션 URI에 이 주소를 넣으세요:")} <code>{hub.google.redirectUri}</code></p>
              )}
              <button>{t("Save and test", "저장하고 시험")}</button>
            </form>
          </div>
        </>
      ),
    });
  });
  app.post("/connections", async (c) => {
    const f = await c.req.parseBody();
    const def = findDef(String(f.provider ?? ""));
    if (!def) return c.text("unknown provider", 400);
    const name = String(f.name ?? "");
    if (!/^[A-Za-z0-9가-힣_-]{1,32}$/.test(name)) return c.text("invalid name", 400);
    const cfg = def.config.safeParse(valuesOf(fieldsOf(def.config), f as any, "config"));
    if (!cfg.success) return c.text(`invalid settings: ${cfg.error.issues.map((i) => i.path.join(".")).join(", ")}`, 400);
    const sec = valuesOf(fieldsOf(def.secrets, true), f as any, "secret") as Record<string, string>;
    // Editing an existing connection: blank secret fields keep their value; engine-filled (@internal) values are kept.
    const existing = await hub.connections.get(def.kind, name);
    const internal = (shape: Record<string, { description?: string }> | undefined, from: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(shape ?? {}).filter((k) => shape![k]!.description === INTERNAL && from[k] !== undefined).map((k) => [k, from[k]]));
    const config = existing ? { ...cfg.data, ...internal(def.config.shape, existing.config) } : cfg.data;
    const secrets = existing && Object.keys(sec).length ? { ...(await hub.connections.secretsOf(existing.id)), ...sec } : sec;
    const id = await hub.connections.upsert({ kind: def.kind, provider: def.id, name, config, secrets: Object.keys(secrets).length ? secrets : undefined }, actor(c));
    await hub.reload();
    return c.redirect(`${B}/connections/${id}/test-result`);
  });
  const testConnection = async (id: string) => {
    const con = (await hub.connections.list()).find((x) => x.id === id);
    if (!con) return "unknown connection";
    const def = hub.providers.find((p) => p.kind === con.kind && p.id === con.provider);
    try {
      const inst = await hub.provider(con.kind, con.name);
      if (def?.test && inst) await def.test(inst as never);
      await hub.connections.setStatus(id, true);
      return "ok";
    } catch (e) {
      const msg = (e as Error).message.slice(0, 200);
      await hub.connections.setStatus(id, false, msg);
      return msg;
    }
  };
  const testResult = async (c: Context, id: string) => {
    const r = await testConnection(id);
    const t = await T(c);
    return back(c, B, "/connections", r === "ok" ? { ok: t("Connected.", "연결됐어요.") } : { err: t(`Could not connect: ${r}`, `연결하지 못했어요: ${r}`) });
  };
  app.get("/connections/:id/test-result", (c) => testResult(c, c.req.param("id")));
  app.post("/connections/:id/test", (c) => testResult(c, c.req.param("id")));
  app.post("/connections/:id/google", async (c) => {
    try {
      return c.redirect(await hub.google.start(c.req.param("id")));
    } catch (e) {
      return back(c, B, "/connections", { err: (e as Error).message.slice(0, 200) });
    }
  });
  app.post("/connections/:id/disable", async (c) => {
    await hub.platform.db.run(`UPDATE connections SET enabled = 0 WHERE id = ?`, [c.req.param("id")]);
    await hub.reload();
    return back(c, B, "/connections", { ok: (await T(c))("Turned off.", "껐어요.") });
  });

  // ---- features ----
  app.get("/features", async (c) => {
    const s = await hub.settings.get();
    const others = (await hub.connections.list()).filter((x) => x.kind !== "storage");
    const on = (id: string) => !!hub.moduleStatus.find((m) => m.id === id)?.enabled;
    const NoteLang = (p: { v: string; t: Tr }) => (
      <label>{p.t("Language of notes", "노트 언어")}<select name="language"><option value="ko" selected={p.v === "ko"}>한국어</option><option value="en" selected={p.v === "en"}>English</option></select></label>
    );
    return frame(c, {
      title: ["Features", "기능"],
      active: "/features",
      children: (t) => (
        <>
          <h1>{t("Features", "기능")}</h1>
          <div class="card">
            <h2>{t("What memexhub does", "memexhub가 하는 일")}</h2>
            <form method="post" action={`${B}/modules`}>
              <Csrf c={c} />
              {hub.moduleStatus.map((m) => {
                const n = MODULE_NAMES[m.id] ?? [m.id, m.id, "", ""];
                return (
                  <Check name="on" value={m.id} checked={m.enabled} disabled={m.id === "vault" || m.id === "hub"}>
                    <b>{t(n[0], n[1])}</b> <span class="muted">— {t(n[2], n[3])}</span>
                    {m.error ? <span class="hint err">{m.error}</span> : null}
                  </Check>
                );
              })}
              <button>{t("Save", "저장")}</button>
            </form>
          </div>

          {on("ledger") && (
            <div class="card" id="ledger">
              <h2>{t("Payments", "결제")}</h2>
              <p><a href={`${B}/ledger/recipes`}>{t("Recipes & inbox", "레시피·대기함")} →</a> <span class="muted">{t("teach new message formats, handle what could not be read", "새 메시지 형식 알려주기, 못 읽은 것 처리")}</span></p>
              <form method="post" action={`${B}/ledger`}>
                <Csrf c={c} />
                <label>{t("Payments note", "결제 노트")}<span class="hint">{t("{year} becomes the year.", "{year}는 연도로 바뀌어요.")}</span><input name="paymentsNote" value={s.ledger.paymentsNote} /></label>
                <label>{t("Money note", "돈 노트")}<input name="moneyNote" value={s.ledger.moneyNote} /></label>
                <label>{t("Office places", "회사 장소")}<span class="hint">{t("Place names from your location source, comma separated. Commutes there are tagged.", "위치 출처의 장소 이름, 쉼표로 구분. 그곳 출퇴근을 표시해요.")}</span><input name="officePlaces" value={s.ledger.officePlaces.join(", ")} /></label>
                <label>{t("Receipt mail folders", "영수증 메일 폴더")}<span class="hint">{t("One per line as account: folder. Read every 15 minutes.", "한 줄에 하나씩 계정: 폴더. 15분마다 읽어요.")}</span><textarea name="mailSources" rows={3} placeholder="kakao: Payments">{s.ledger.mailSources.map((m) => `${m.connection}: ${m.folder}`).join("\n")}</textarea></label>
                <label>{t("Keep unreadable messages (days)", "못 읽은 메시지 보관 (일)")}<input name="inboxDays" type="number" min="1" max="365" value={String(s.ledger.inboxDays)} /></label>
                <NoteLang v={s.ledger.language} t={t} />
                <button>{t("Save", "저장")}</button>
              </form>
            </div>
          )}

          {on("location") && (
            <div class="card" id="location">
              <h2>{t("Location", "위치")}</h2>
              <form method="post" action={`${B}/location`}>
                <Csrf c={c} />
                <label>{t("Location source", "위치 출처")}
                  <select name="connection"><option value="">{t("First connected", "처음 연결된 것")}</option>{others.filter((x) => x.kind === "location").map((x) => <option value={x.name} selected={s.location.connection === x.name}>{x.name} ({x.provider})</option>)}</select>
                </label>
                <label>{t("Place names", "장소 이름")}
                  <select name="geocoder"><option value="">{t("First connected", "처음 연결된 것")}</option>{others.filter((x) => x.kind === "geocoder").map((x) => <option value={x.name} selected={s.location.geocoder === x.name}>{x.name} ({x.provider})</option>)}</select>
                </label>
                <label>{t("Private places", "비공개 장소")}<span class="hint">{t("Never written anywhere. Comma separated.", "어디에도 쓰지 않아요. 쉼표로 구분.")}</span><input name="privateAreas" value={s.location.privateAreas.join(", ")} /></label>
                <NoteLang v={s.location.language} t={t} />
                <button>{t("Save", "저장")}</button>
              </form>
              <p class="muted">{t("Phone app: OwnTracks in HTTP mode → https://<your address>/ingest/owntracks, with a device token that may send “Location” as the password.", "폰 앱: OwnTracks HTTP 모드 → https://<내 주소>/ingest/owntracks, 비밀번호는 “위치” 권한의 기기 토큰.")}</p>
            </div>
          )}

          {on("health") && (
            <div class="card" id="health">
              <h2>{t("Health", "건강")}</h2>
              <form method="post" action={`${B}/health`}>
                <Csrf c={c} />
                <label>{t("Health note", "건강 노트")}<span class="hint">{t("{year} becomes the year.", "{year}는 연도로 바뀌어요.")}</span><input name="note" value={s.health.note} /></label>
                <NoteLang v={s.health.language} t={t} />
                <button>{t("Save", "저장")}</button>
              </form>
            </div>
          )}

          <div class="card" id="notion">
            <h2>Notion</h2>
            <form method="post" action={`${B}/notion`}>
              <Csrf c={c} />
              <label>{t("Notion connection", "Notion 연결")}
                <select name="connection"><option value="">{t("First connected", "처음 연결된 것")}</option>{others.filter((x) => x.kind === "notion").map((x) => <option value={x.name} selected={s.notion.connection === x.name}>{x.name}</option>)}</select>
              </label>
              <Check name="ledger" checked={s.notion.ledger}>{t("Copy payments into a Notion database", "결제를 Notion 데이터베이스로 복사")}</Check>
              <Check name="health" checked={s.notion.health}>{t("Copy health days into a Notion database", "건강 기록을 Notion 데이터베이스로 복사")}</Check>
              <button>{t("Save", "저장")}</button>
              {(s.notion.ledger || s.notion.health) && <button class="secondary" formaction={`${B}/notion/sync`}>{t("Sync now", "지금 동기화")}</button>}
              <p class="muted">{t("Notion is an outside service: what you switch on here is copied there every 15 minutes. Re-syncing never duplicates rows.", "Notion은 바깥 서비스예요. 켠 것은 15분마다 그쪽으로 복사돼요. 다시 동기화해도 중복되지 않아요.")}</p>
            </form>
          </div>
        </>
      ),
    });
  });
  app.post("/modules", async (c) => {
    const f = await c.req.parseBody({ all: true });
    const on = new Set([f.on].flat().filter(Boolean).map(String));
    const modules = Object.fromEntries(hub.moduleStatus.map((m) => [m.id, { enabled: m.id === "vault" || m.id === "hub" || on.has(m.id) }]));
    await hub.settings.set("modules", modules);
    await hub.reload();
    return back(c, B, "/features", { ok: (await T(c))("Saved.", "저장했어요.") });
  });
  app.post("/ledger", async (c) => {
    const f = await c.req.parseBody();
    const s = await hub.settings.get();
    const note = (v: unknown, d: string) => {
      const x = String(v ?? "").trim();
      return /^[^.\/][^\0]*\.md$/.test(x) && !x.includes("..") ? x : d;
    };
    await hub.settings.set("ledger", {
      officePlaces: String(f.officePlaces ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20),
      paymentsNote: note(f.paymentsNote, s.ledger.paymentsNote),
      moneyNote: note(f.moneyNote, s.ledger.moneyNote),
      language: f.language === "ko" ? "ko" : "en",
      inboxDays: Math.min(365, Math.max(1, Number(f.inboxDays) || s.ledger.inboxDays)),
      mailSources: String(f.mailSources ?? "").split("\n").map((l) => l.match(/^\s*([^:]{1,32}?)\s*:\s*(.{1,200}?)\s*$/)).filter((m): m is RegExpMatchArray => !!m).slice(0, 10).map((m) => ({ connection: m[1]!, folder: m[2]! })),
    });
    await hub.reload();
    return back(c, B, "/features", { ok: (await T(c))("Payments saved.", "결제 설정을 저장했어요.") });
  });
  app.post("/health", async (c) => {
    const f = await c.req.parseBody();
    const s = await hub.settings.get();
    const x = String(f.note ?? "").trim();
    await hub.settings.set("health", {
      note: /^[^.\/][^\0]*\.md$/.test(x) && !x.includes("..") && x.includes("{year}") ? x : s.health.note,
      language: f.language === "ko" ? "ko" : "en",
    });
    await hub.reload();
    return back(c, B, "/features", { ok: (await T(c))("Health saved.", "건강 설정을 저장했어요.") });
  });
  app.post("/notion", async (c) => {
    const f = await c.req.parseBody();
    const s0 = await hub.settings.get();
    const conns = await hub.connections.list("notion");
    const name = String(f.connection ?? "");
    await hub.settings.set("notion", { connection: conns.some((x) => x.name === name) ? name : undefined, ledger: f.ledger === "on", health: f.health === "on" });
    // Switching a kind on also turns the Notion feature on (one step instead of two).
    if (f.ledger === "on" || f.health === "on") await hub.settings.set("modules", { ...s0.modules, notion: { enabled: true } });
    await hub.reload();
    return back(c, B, "/features", { ok: (await T(c))("Notion saved.", "Notion 설정을 저장했어요.") });
  });
  app.post("/notion/sync", async (c) => {
    const api = hub.moduleAdmin.get("notion") as { sync(): Promise<{ kind: string; created: number; updated: number; unchanged: number; more: boolean }[]> } | undefined;
    const t = await T(c);
    try {
      const r = api ? await api.sync() : [];
      return back(c, B, "/features", {
        ok: r.length
          ? r.map((x) => t(`${x.kind}: ${x.created} new, ${x.updated} updated, ${x.unchanged} unchanged${x.more ? " (more next time)" : ""}`, `${x.kind}: 새로 ${x.created}, 바뀜 ${x.updated}, 그대로 ${x.unchanged}${x.more ? " (나머지는 다음에)" : ""}`)).join(" · ")
          : t("Nothing to sync — switch payments or health on.", "동기화할 것이 없어요. 결제나 건강을 켜세요."),
      });
    } catch (e) {
      return back(c, B, "/features", { err: t(`Sync failed: ${(e as Error).message.slice(0, 160)}`, `동기화 실패: ${(e as Error).message.slice(0, 160)}`) });
    }
  });
  app.post("/location", async (c) => {
    const f = await c.req.parseBody();
    const s = await hub.settings.get();
    const conns = await hub.connections.list();
    const name = (v: unknown, kind: string) => {
      const x = String(v ?? "").trim();
      return x && conns.some((n) => n.kind === kind && n.name === x) ? x : undefined;
    };
    await hub.settings.set("location", {
      ...s.location,
      connection: name(f.connection, "location"),
      geocoder: name(f.geocoder, "geocoder"),
      privateAreas: String(f.privateAreas ?? "").split(",").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 20),
      language: f.language === "ko" ? "ko" : "en",
    });
    await hub.reload();
    return back(c, B, "/features", { ok: (await T(c))("Location saved.", "위치 설정을 저장했어요.") });
  });

  // ---- Claude ----
  app.get("/claude", async (c) => {
    const s = await hub.settings.get();
    const clients = await hub.oauth.clients();
    const tools = await hub.visibleTools();
    const now = hub.platform.now();
    return frame(c, {
      title: ["Claude", "Claude"],
      active: "/claude",
      children: (t) => (
        <>
          <h1>Claude</h1>
          <div class="card">
            <h2>{t("Connect the Claude app", "Claude 앱 연결")}</h2>
            <p>{t("In the Claude app: Settings → Connectors → Add custom connector → paste this address, then sign in with your admin account.", "Claude 앱: 설정 → 커넥터 → 사용자 지정 커넥터 추가 → 이 주소를 붙여 넣고 관리자 계정으로 로그인하세요.")}</p>
            <pre>{hub.env.PUBLIC_URL}/mcp</pre>
          </div>
          <div class="card">
            <h2>{t("Signed-in apps", "로그인한 앱")}</h2>
            {clients.length ? (
              <ul class="list">
                {clients.map((cl) => (
                  <li style="flex-wrap:wrap">
                    <span class={`dot ${cl.revoked_at ? "" : "ok"}`} />
                    <span style="flex:1;min-width:12rem"><b>{cl.client_name ?? cl.client_id}</b><span class="hint">{cl.revoked_at ? t("Revoked", "해제됨") : t(`Last used ${ago(t, cl.last_token_at, now, s.timezone)} · added ${when(cl.created_at, s.timezone)}`, `마지막 사용 ${ago(t, cl.last_token_at, now, s.timezone)} · 추가 ${when(cl.created_at, s.timezone)}`)}</span></span>
                    {!cl.revoked_at && <form method="post" action={`${B}/oauth/${cl.client_id}/revoke`} class="inline"><Csrf c={c} /><button class="secondary small">{t("Revoke", "해제")}</button></form>}
                  </li>
                ))}
              </ul>
            ) : <p class="muted">{t("No app has signed in yet.", "아직 로그인한 앱이 없어요.")}</p>}
          </div>
          <div class="card">
            <h2>{t("Tools", "도구")} <span class="muted">({tools.length})</span></h2>
            <p>{tools.map((x) => <span class="tag">{x.name}</span>)}</p>
            <form method="post" action={`${B}/settings/language`}>
              <Csrf c={c} />
              <label>{t("Tool description language", "도구 설명 언어")}
                <select name="toolLanguage">
                  {(["ko", "en", "both"] as const).map((l) => <option value={l} selected={s.toolLanguage === l}>{{ en: "English", ko: "한국어", both: t("Both", "둘 다") }[l]}</option>)}
                </select>
              </label>
              <button>{t("Save", "저장")}</button>
            </form>
            <p class="muted">{t("Destructive tools (delete, move) appear only when switched on in settings.", "지우기·옮기기 같은 위험한 도구는 설정에서 켠 경우에만 보여요.")}</p>
          </div>
        </>
      ),
    });
  });
  app.post("/settings/language", async (c) => {
    const f = await c.req.parseBody();
    const l = String(f.toolLanguage);
    if (l === "en" || l === "ko" || l === "both") await hub.settings.set("toolLanguage", l);
    return back(c, B, "/claude", { ok: (await T(c))("Saved.", "저장했어요.") });
  });
  app.post("/oauth/:id/revoke", async (c) => {
    await hub.oauth.revokeClient(c.req.param("id"), actor(c));
    return back(c, B, "/claude", { ok: (await T(c))("Revoked. That app has to sign in again.", "해제했어요. 그 앱은 다시 로그인해야 해요.") });
  });

  // ---- devices ----
  app.get("/devices", async (c) => {
    const s = await hub.settings.get();
    const tokens = await hub.ingestTokens.list();
    const newToken = c.req.query("new_token");
    const now = hub.platform.now();
    return frame(c, {
      title: ["Devices", "기기"],
      active: "/devices",
      children: (t) => (
        <>
          <h1>{t("Devices", "기기")}</h1>
          <p class="muted">{t("One token per sender — a phone automation, an app, a script. A token can only send records, never read.", "보내는 곳마다 토큰 하나 — 폰 자동화, 앱, 스크립트. 토큰은 기록을 보내기만 하고 읽지는 못해요.")}</p>
          {newToken && (
            <div class="card" role="status">
              <h2 class="ok">{t("New token", "새 토큰")}</h2>
              <p>{t("Copy it now — it will not be shown again.", "지금 복사하세요. 다시 보여주지 않아요.")}</p>
              <pre>{newToken}</pre>
            </div>
          )}
          <div class="card">
            <h2>{t("Tokens", "토큰")}</h2>
            {tokens.length ? (
              <ul class="list">
                {tokens.map((x) => (
                  <li style="flex-wrap:wrap">
                    <span class={`dot ${x.revoked_at ? "" : "ok"}`} />
                    <span style="flex:1;min-width:12rem"><b>{x.name}</b> {(JSON.parse(x.scopes) as string[]).map((sc) => <span class="tag">{scopeName(t, sc)}</span>)}<span class="hint">{x.revoked_at ? t("Revoked", "해제됨") : t(`Last sent ${ago(t, x.last_used_at, now, s.timezone)}`, `마지막 수신 ${ago(t, x.last_used_at, now, s.timezone)}`)}</span></span>
                    {!x.revoked_at && <form method="post" action={`${B}/tokens/${x.id}/revoke`} class="inline"><Csrf c={c} /><button class="secondary small">{t("Revoke", "해제")}</button></form>}
                  </li>
                ))}
              </ul>
            ) : <p class="muted">{t("No tokens yet.", "아직 토큰이 없어요.")}</p>}
          </div>
          <div class="card">
            <h2>{t("Create a token", "토큰 만들기")}</h2>
            <form method="post" action={`${B}/tokens`}>
              <Csrf c={c} />
              <label>{t("Name", "이름")}<input name="name" placeholder={t("my phone", "내 폰")} required maxlength={60} /></label>
              <p style="margin-bottom:0">{t("May send", "보낼 수 있는 것")}</p>
              {SCOPES.map(([id, en, ko]) => <Check name="scope" value={id} checked={id === "ledger" || id === "health"}>{t(en, ko)}</Check>)}
              <button>{t("Create token", "토큰 만들기")}</button>
            </form>
          </div>
          <div class="card">
            <h2>{t("Where to send", "보내는 주소")}</h2>
            <p class="muted">{t("Send the token in the X-Ingest-Token header, or as the password of HTTP Basic sign-in.", "토큰은 X-Ingest-Token 헤더나 HTTP Basic 인증의 비밀번호로 보내요.")}</p>
            <ul class="list">
              <li><code>/ingest/message</code><span class="muted">{t("raw text: card SMS, notification", "원문: 카드 문자, 알림")}</span></li>
              <li><code>/ingest/transaction</code><span class="muted">{t("wallet payment", "지갑 결제")}</span></li>
              <li><code>/ingest/health</code><span class="muted">{t("health day", "건강 기록")}</span></li>
              <li><code>/ingest/owntracks</code><span class="muted">{t("location (OwnTracks)", "위치 (OwnTracks)")}</span></li>
            </ul>
          </div>
        </>
      ),
    });
  });
  app.post("/tokens", async (c) => {
    const f = await c.req.parseBody({ all: true });
    // Checkboxes ("scope"), or the comma-separated field ("scopes") older forms and scripts send.
    const picked = [f.scope].flat().filter(Boolean).map(String);
    const scopes = (picked.length ? picked : String(f.scopes ?? "").split(",")).map((s) => s.trim()).filter((s) => /^[a-z*]+$/.test(s));
    if (!scopes.length) return back(c, B, "/devices", { err: (await T(c))("Pick at least one thing the token may send.", "토큰이 보낼 수 있는 것을 하나 이상 고르세요.") });
    const { token } = await hub.ingestTokens.create(String(f.name ?? "").slice(0, 60), scopes, actor(c));
    return c.redirect(`${B}/devices?new_token=${encodeURIComponent(token)}`);
  });
  app.post("/tokens/:id/revoke", async (c) => {
    await hub.ingestTokens.revoke(c.req.param("id"), actor(c));
    return back(c, B, "/devices", { ok: (await T(c))("Revoked.", "해제했어요.") });
  });

  // ---- security ----
  app.get("/security", async (c) => {
    const s = await hub.settings.get();
    const totp = await hub.admin.hasTotp(c.get("adminId"));
    const checks = await checksFor(c, await T(c));
    return frame(c, {
      title: ["Security", "보안"],
      active: "/security",
      children: (t) => (
        <>
          <h1>{t("Security", "보안")}</h1>
          <div class="card">
            <h2>{t("Checks", "점검")}</h2>
            <ul class="list">
              {checks.map((x) => <li><span class={`dot ${x.ok ? "ok" : x.level === "high" ? "err" : ""}`} /><span>{x.ok ? "✓" : "⚠"} {x.text}</span></li>)}
            </ul>
          </div>
          <div class="card">
            <h2>{t("Two-factor sign-in", "2단계 인증")}</h2>
            {totp ? <p class="ok">{t("On.", "켜져 있어요.")}</p> : (
              <>
                <p class="muted">{t("Needed to use this page from outside your network. Takes a minute with any authenticator app.", "집 밖에서 이 화면을 쓰려면 필요해요. 인증 앱으로 1분이면 돼요.")}</p>
                <form method="post" action={`${B}/totp`}><Csrf c={c} /><button>{t("Turn on two-factor", "2단계 인증 켜기")}</button></form>
              </>
            )}
          </div>
          <div class="card">
            <h2>{t("Who may call /mcp", "/mcp를 부를 수 있는 곳")}</h2>
            <p class="muted">{s.mcp.enforceAllow ? t("Only Anthropic's servers (the Claude apps go through them).", "Anthropic 서버만 (Claude 앱은 이 서버를 거쳐요).") : t("Any address, with sign-in. Restricting it blocks stolen tokens used elsewhere.", "로그인만 하면 어디서나. 제한하면 다른 곳에서 훔친 토큰을 써도 막혀요.")}</p>
            <form method="post" action={`${B}/mcp-allow`}>
              <Csrf c={c} />
              <input type="hidden" name="enforce" value={s.mcp.enforceAllow ? "0" : "1"} />
              <button class={s.mcp.enforceAllow ? "secondary" : ""}>{s.mcp.enforceAllow ? t("Allow any address", "모든 주소 허용") : t("Only allow Anthropic servers to call /mcp", "Anthropic 서버만 허용")}</button>
            </form>
          </div>
          <div class="card" id="outside">
            <h2>{t("Use this page from outside", "밖에서 관리 화면 쓰기")}</h2>
            {hub.env.ADMIN_PUBLIC || hub.platform.name === "workers" ? (
              <p class="muted">{t("This server always serves the admin UI over the internet; two-factor is required there.", "이 서버는 관리 화면을 항상 인터넷으로 열어요. 그때는 2단계 인증이 필요해요.")}</p>
            ) : s.admin.allowPublic ? (
              <>
                <p><span class="dot ok" />{t("Open from anywhere at", "어디서나 열 수 있어요:")} <code>{hub.env.PUBLIC_URL}/admin</code></p>
                <p class="muted">{t("Sign-in from outside needs the password and the authenticator code.", "밖에서 로그인할 때는 비밀번호와 인증 앱 코드가 필요해요.")}</p>
                <form method="post" action={`${B}/admin-public`}><Csrf c={c} /><input type="hidden" name="enable" value="0" /><button class="secondary">{t("Home network only", "집 네트워크에서만 열기")}</button></form>
              </>
            ) : (
              <>
                <p class="muted">{t("Now only on your home network. Turn on two-factor first, then you can open it from anywhere.", "지금은 집 네트워크에서만 열려요. 2단계 인증을 먼저 켜면 어디서나 열 수 있어요.")}</p>
                <form method="post" action={`${B}/admin-public`}><Csrf c={c} /><input type="hidden" name="enable" value="1" /><button disabled={!totp} class={totp ? "" : "secondary"}>{t("Open from anywhere", "어디서나 열기")}</button></form>
              </>
            )}
          </div>
          <div class="card">
            <h2>{t("Protected from Claude", "Claude가 못 고치는 곳")}</h2>
            <p>{s.vault.protectedPaths.map((p) => <code style="margin-right:.3rem">{p}</code>)}</p>
          </div>
          <form method="post" action={`${B}/logout`}><Csrf c={c} /><button class="secondary">{t("Sign out", "로그아웃")}</button></form>
        </>
      ),
    });
  });

  const enrolPage = async (c: Context<Vars>, secret: string, error?: string) => {
    const t = await T(c);
    return bare(c, t("Two-factor", "2단계 인증"), (
      <div class="card">
        <h1>{t("Add memexhub to your authenticator", "인증 앱에 memexhub 추가")}</h1>
        <p>{t("Enter this key in your authenticator app (or open the link on your phone), then type the 6-digit code it shows.", "이 키를 인증 앱에 넣거나(폰에서는 링크를 열어도 돼요), 앱에 나온 6자리 코드를 입력하세요.")}</p>
        <pre>{secret}</pre>
        <p class="muted">{`otpauth://totp/memexhub:admin?secret=${secret}&issuer=memexhub`}</p>
        {error && <p class="err" role="alert">{error}</p>}
        <form method="post" action={`${B}/totp/confirm`}>
          <Csrf c={c} />
          <input type="hidden" name="secret_shown" value="1" />
          <label>{t("6-digit code", "6자리 코드")}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required /></label>
          <button>{t("Turn on two-factor", "2단계 인증 켜기")}</button>
        </form>
        <p class="muted">{t("Nothing changes until the code is right. The key is not shown again after that.", "코드가 맞기 전에는 아무것도 바뀌지 않아요. 그 뒤에는 키를 다시 보여주지 않아요.")}</p>
      </div>
    ));
  };
  app.get("/two-factor", async (c) => {
    const t = await T(c);
    return bare(c, t("Turn on two-factor", "2단계 인증 켜기"), (
      <div class="card">
        <h1>{t("Turn on two-factor first", "먼저 2단계 인증을 켜세요")}</h1>
        <p>{t("You are reaching the admin UI over the internet. Before anything else, add memexhub to an authenticator app (1Password, Google Authenticator, Aegis …). It takes a minute.", "인터넷을 거쳐 관리 화면에 들어왔어요. 먼저 인증 앱(1Password, Google Authenticator, Aegis 등)에 memexhub를 추가하세요. 1분이면 돼요.")}</p>
        <form method="post" action={`${B}/totp`}><Csrf c={c} /><button>{t("Set up two-factor", "2단계 인증 설정")}</button></form>
      </div>
    ));
  });
  app.post("/totp", async (c) => {
    if (await hub.admin.hasTotp(c.get("adminId"))) return c.redirect(`${B}/security`);
    return enrolPage(c, await hub.admin.startTotp(c.get("adminId")));
  });
  app.post("/totp/confirm", async (c) => {
    const f = await c.req.parseBody();
    const id = c.get("adminId");
    if (await hub.admin.confirmTotp(id, String(f.code ?? ""))) return back(c, B, "/security", { ok: (await T(c))("Two-factor is on.", "2단계 인증을 켰어요.") });
    const secret = await hub.admin.pendingTotp(id);
    if (!secret) return c.redirect(`${B}/two-factor`);
    return enrolPage(c, secret, (await T(c))("That code did not match. Check the time on your phone and try the newest code.", "코드가 맞지 않아요. 폰 시간을 확인하고 가장 새 코드를 넣어 보세요."));
  });
  app.post("/admin-public", async (c) => {
    const f = await c.req.parseBody();
    const t = await T(c);
    const s = await hub.settings.get();
    const enable = f.enable === "1";
    if (enable && !(await hub.admin.hasTotp(c.get("adminId")))) return back(c, B, "/security", { err: t("Turn on two-factor first.", "먼저 2단계 인증을 켜세요.") });
    await hub.settings.set("admin", { ...s.admin, allowPublic: enable });
    await audit(hub.platform.db, actor(c), enable ? "admin.open_outside" : "admin.home_only");
    return back(c, B, "/security", { ok: enable ? t("The admin UI now opens from anywhere (with two-factor).", "이제 어디서나 관리 화면을 열 수 있어요(2단계 인증 필요).") : t("The admin UI is home-network only again.", "다시 집 네트워크에서만 열려요.") });
  });
  app.post("/mcp-allow", async (c) => {
    const f = await c.req.parseBody();
    await hub.settings.set("mcp", { allowCidrs: ANTHROPIC_OUTBOUND_CIDRS, enforceAllow: f.enforce === "1" });
    return back(c, B, "/security", { ok: (await T(c))("Saved.", "저장했어요.") });
  });
  app.post("/logout", async (c) => {
    const sid = getCookie(c, COOKIE);
    if (sid) await hub.admin.logout(sid);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect(`${B}/login`);
  });

  return app;
}

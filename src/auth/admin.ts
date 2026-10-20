import type { Db } from "../platform/types.js";
import { base32Encode, decrypt, encrypt, hashPassword, randomBytes, randomToken, sha256Hex, safeEqual, verifyPassword, verifyTotp } from "../core/crypto.js";
import { audit } from "../core/audit.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const TRUST_MS = 30 * 86_400_000;
/** "Stay signed in": the session lives this long from sign-in, however idle. */
export const STAY_MS = 30 * 86_400_000;

/**
 * Admin accounts, sessions and the first-run setup code.
 * Until an admin exists the instance is "unclaimed": MCP and ingest refuse requests,
 * and the setup wizard needs a one-time code that is only printed to the server log.
 */
export class AdminAuth {
  private setupCodeHash?: string;
  private failures = new Map<string, { n: number; until: number }>();

  constructor(private db: Db, private secret: string) {}

  async hasAdmin() {
    return !!(await this.db.get(`SELECT id FROM admins LIMIT 1`));
  }

  /** Call at boot when unclaimed. Returns the code to print to the log (never stored in clear). */
  async issueSetupCode(): Promise<string> {
    const code = base32Encode(randomBytes(10)).slice(0, 16).replace(/(.{4})(?!$)/g, "$1-");
    this.setupCodeHash = await sha256Hex(code.replace(/-/g, ""));
    return code;
  }

  /** Runtimes without a readable log (Cloudflare Workers) take the setup code from a secret instead. */
  async useSetupCode(code: string) {
    if (code.replace(/[-\s]/g, "").length < 12) throw new Error("SETUP_CODE must be at least 12 characters");
    this.setupCodeHash = await sha256Hex(code.replace(/[-\s]/g, "").toUpperCase());
  }

  async checkSetupCode(code: string) {
    if (!this.setupCodeHash) return false;
    return safeEqual(await sha256Hex(code.replace(/[-\s]/g, "").toUpperCase()), this.setupCodeHash);
  }

  async createAdmin(username: string, password: string, actor: string) {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("username: 3-32 letters, digits, _ . -");
    if (password.length < 12) throw new Error("password must be at least 12 characters");
    const id = randomToken("adm_").slice(0, 20);
    await this.db.run(`INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`, [
      id, username, await hashPassword(password), new Date().toISOString(),
    ]);
    this.setupCodeHash = undefined; // claimed — the setup code dies
    await audit(this.db, actor, "admin.create", id, { username });
    return id;
  }

  /**
   * Throttles by key (ip+username): 5 failures → locked for 15 minutes.
   * With two-factor on, the code is asked unless `o.skipTotp` (the home network) or `o.trusted` is a remembered
   * browser of this admin. A login that needed and passed the code reports `usedTotp`.
   */
  async login(username: string, password: string, totpCode: string | undefined, key: string, o: { skipTotp?: boolean; trusted?: string } = {}): Promise<string | null> {
    return (await this.loginDetail(username, password, totpCode, key, o))?.id ?? null;
  }
  async loginDetail(username: string, password: string, totpCode: string | undefined, key: string, o: { skipTotp?: boolean; trusted?: string } = {}): Promise<{ id: string; usedTotp: boolean } | null> {
    const f = this.failures.get(key);
    if (f && f.until > Date.now()) return null;
    const row = await this.db.get<{ id: string; password_hash: string; totp_secret_enc: string | null }>(
      `SELECT id, password_hash, totp_secret_enc FROM admins WHERE username = ?`,
      [username],
    );
    // Always run a hash comparison so timing does not reveal whether the user exists.
    const ok =
      (await verifyPassword(password, row?.password_hash ?? "pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")) && !!row;
    let totpOk = true;
    let usedTotp = false;
    if (ok && row?.totp_secret_enc && !o.skipTotp && !(o.trusted && (await this.isTrusted(row.id, o.trusted)))) {
      const s = await decrypt(this.secret, "totp", row.totp_secret_enc, row.id);
      totpOk = !!totpCode && (await verifyTotp(s, totpCode, Date.now()));
      usedTotp = totpOk;
    }
    if (!ok || !totpOk || !row) {
      const n = (f?.n ?? 0) + 1;
      this.failures.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      await audit(this.db, "anonymous", "admin.login_failed", undefined, { username });
      return null;
    }
    this.failures.delete(key);
    await audit(this.db, `admin:${row.id}`, "admin.login");
    return { id: row.id, usedTotp };
  }

  /** Remember this browser for 30 days (after it passed two-factor). Returns the cookie value. */
  async trustDevice(adminId: string): Promise<string> {
    const token = randomToken("trd_");
    const now = Date.now();
    await this.db.run(`INSERT INTO admin_trusted (id_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, [await sha256Hex(token), adminId, new Date(now).toISOString(), new Date(now + TRUST_MS).toISOString()]);
    await this.db.run(`DELETE FROM admin_trusted WHERE expires_at < ?`, [new Date(now).toISOString()]);
    return token;
  }
  private async isTrusted(adminId: string, token: string) {
    const row = await this.db.get<{ expires_at: string }>(`SELECT expires_at FROM admin_trusted WHERE id_hash = ? AND admin_id = ?`, [await sha256Hex(token), adminId]);
    return !!row && Date.parse(row.expires_at) > Date.now();
  }
  /** Browsers that stay signed in or skip the code: the larger of the two counts (one browser usually has both). */
  async trustedCount(adminId: string) {
    const now = new Date().toISOString();
    const a = (await this.db.get<{ n: number }>(`SELECT COUNT(*) n FROM admin_trusted WHERE admin_id = ? AND expires_at > ?`, [adminId, now]))?.n ?? 0;
    const b = (await this.db.get<{ n: number }>(`SELECT COUNT(*) n FROM admin_sessions WHERE admin_id = ? AND expires_at > ?`, [adminId, now]))?.n ?? 0;
    return Math.max(a, b);
  }
  /** Forget every remembered browser: no more skipped codes, and long sessions end (this one becomes a normal session). */
  async forgetDevices(adminId: string, currentSid?: string) {
    await this.db.run(`DELETE FROM admin_trusted WHERE admin_id = ?`, [adminId]);
    const keep = currentSid ? await sha256Hex(currentSid) : "";
    await this.db.run(`DELETE FROM admin_sessions WHERE admin_id = ? AND expires_at IS NOT NULL AND id_hash != ?`, [adminId, keep]);
    await this.db.run(`UPDATE admin_sessions SET expires_at = NULL, last_seen_at = ? WHERE id_hash = ?`, [new Date().toISOString(), keep]);
  }

  /** New password: checks the current one, signs out every other session and forgets remembered browsers. */
  async changePassword(adminId: string, current: string, next: string, keepSid: string | undefined): Promise<boolean> {
    if (next.length < 12) throw new Error("password must be at least 12 characters");
    const row = await this.db.get<{ password_hash: string }>(`SELECT password_hash FROM admins WHERE id = ?`, [adminId]);
    if (!row || !(await verifyPassword(current, row.password_hash))) return false;
    const keep = keepSid ? await sha256Hex(keepSid) : "";
    await this.db.batch([
      { sql: `UPDATE admins SET password_hash = ? WHERE id = ?`, params: [await hashPassword(next), adminId] },
      { sql: `DELETE FROM admin_sessions WHERE admin_id = ? AND id_hash != ?`, params: [adminId, keep] },
      { sql: `DELETE FROM admin_trusted WHERE admin_id = ?`, params: [adminId] },
    ]);
    await audit(this.db, `admin:${adminId}`, "admin.password_changed");
    return true;
  }

  /**
   * Two-step enrolment: a new secret is kept pending (encrypted, 15 minutes) until a code from the
   * authenticator app proves it was added — a mis-scan can never lock the owner out.
   */
  async startTotp(adminId: string): Promise<string> {
    const s = base32Encode(randomBytes(20));
    const blob = await encrypt(this.secret, "totp-pending", JSON.stringify({ s, exp: Date.now() + 15 * 60_000 }), adminId);
    await this.db.run(
      `INSERT INTO cursors (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [`admin.totp_pending:${adminId}`, JSON.stringify(blob), new Date().toISOString()],
    );
    return s;
  }

  /** The pending key, to show it again after a mistyped code. */
  async pendingTotp(adminId: string): Promise<string | undefined> {
    const row = await this.db.get<{ value: string }>(`SELECT value FROM cursors WHERE key = ?`, [`admin.totp_pending:${adminId}`]);
    if (!row) return undefined;
    const p = JSON.parse(await decrypt(this.secret, "totp-pending", JSON.parse(row.value), adminId)) as { s: string; exp: number };
    return p.exp > Date.now() ? p.s : undefined;
  }

  async confirmTotp(adminId: string, code: string): Promise<boolean> {
    const key = `admin.totp_pending:${adminId}`;
    const row = await this.db.get<{ value: string }>(`SELECT value FROM cursors WHERE key = ?`, [key]);
    if (!row) return false;
    const p = JSON.parse(await decrypt(this.secret, "totp-pending", JSON.parse(row.value), adminId)) as { s: string; exp: number };
    if (p.exp < Date.now() || !(await verifyTotp(p.s, code.replace(/\s/g, ""), Date.now()))) return false;
    await this.db.batch([
      { sql: `UPDATE admins SET totp_secret_enc = ? WHERE id = ?`, params: [await encrypt(this.secret, "totp", p.s, adminId), adminId] },
      { sql: `DELETE FROM cursors WHERE key = ?`, params: [key] },
      { sql: `DELETE FROM admin_trusted WHERE admin_id = ?`, params: [adminId] },
    ]);
    await audit(this.db, `admin:${adminId}`, "admin.totp_enabled");
    return true;
  }

  /**
   * Right after setup, an owner who can only reach the admin UI over the internet (Cloudflare) may sign in
   * without two-factor for the one purpose of enrolling it — for 24 hours after the account was created.
   */
  async enrolWindowOpen(adminId: string): Promise<boolean> {
    const row = await this.db.get<{ created_at: string; totp_secret_enc: string | null }>(`SELECT created_at, totp_secret_enc FROM admins WHERE id = ?`, [adminId]);
    return !!row && !row.totp_secret_enc && Date.now() - Date.parse(row.created_at) < 24 * 3600_000;
  }

  async hasTotp(adminId: string) {
    return !!(await this.db.get<{ x: string }>(`SELECT totp_secret_enc x FROM admins WHERE id = ? AND totp_secret_enc IS NOT NULL`, [adminId]));
  }

  /** A new session. Normal ones end after 30 idle minutes; with `stay` it lasts 30 days from now. */
  async createSession(adminId: string, o: { stay?: boolean } = {}): Promise<{ sid: string; csrf: string }> {
    const sid = randomToken("ses_");
    const csrf = randomToken();
    const t = Date.now();
    const now = new Date(t).toISOString();
    await this.db.run(`INSERT INTO admin_sessions (id_hash, admin_id, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, [
      await sha256Hex(sid), adminId, csrf, now, now, o.stay ? new Date(t + STAY_MS).toISOString() : null,
    ]);
    return { sid, csrf };
  }

  async session(sid: string | undefined): Promise<{ adminId: string; csrf: string } | null> {
    if (!sid) return null;
    const h = await sha256Hex(sid);
    const row = await this.db.get<{ admin_id: string; csrf: string; last_seen_at: string; expires_at: string | null }>(
      `SELECT admin_id, csrf, last_seen_at, expires_at FROM admin_sessions WHERE id_hash = ?`,
      [h],
    );
    if (!row) return null;
    const over = row.expires_at ? Date.now() > Date.parse(row.expires_at) : Date.now() - Date.parse(row.last_seen_at) > SESSION_IDLE_MS;
    if (over) {
      await this.db.run(`DELETE FROM admin_sessions WHERE id_hash = ?`, [h]);
      return null;
    }
    await this.db.run(`UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ?`, [new Date().toISOString(), h]);
    return { adminId: row.admin_id, csrf: row.csrf };
  }

  async logout(sid: string) {
    await this.db.run(`DELETE FROM admin_sessions WHERE id_hash = ?`, [await sha256Hex(sid)]);
  }
}

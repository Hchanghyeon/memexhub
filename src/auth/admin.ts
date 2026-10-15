import type { Db } from "../platform/types.js";
import { base32Encode, decrypt, encrypt, hashPassword, randomBytes, randomToken, sha256Hex, safeEqual, verifyPassword, verifyTotp } from "../core/crypto.js";
import { audit } from "../core/audit.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

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

  /** Throttles by key (ip+username): 5 failures → locked for 15 minutes. */
  async login(username: string, password: string, totpCode: string | undefined, key: string): Promise<string | null> {
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
    if (ok && row?.totp_secret_enc) {
      const s = await decrypt(this.secret, "totp", row.totp_secret_enc, row.id);
      totpOk = !!totpCode && (await verifyTotp(s, totpCode, Date.now()));
    }
    if (!ok || !totpOk || !row) {
      const n = (f?.n ?? 0) + 1;
      this.failures.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      await audit(this.db, "anonymous", "admin.login_failed", undefined, { username });
      return null;
    }
    this.failures.delete(key);
    await audit(this.db, `admin:${row.id}`, "admin.login");
    return row.id;
  }

  async enableTotp(adminId: string): Promise<string> {
    const s = base32Encode(randomBytes(20));
    await this.db.run(`UPDATE admins SET totp_secret_enc = ? WHERE id = ?`, [await encrypt(this.secret, "totp", s, adminId), adminId]);
    await audit(this.db, `admin:${adminId}`, "admin.totp_enabled");
    return s;
  }

  async hasTotp(adminId: string) {
    return !!(await this.db.get<{ x: string }>(`SELECT totp_secret_enc x FROM admins WHERE id = ? AND totp_secret_enc IS NOT NULL`, [adminId]));
  }

  async createSession(adminId: string): Promise<{ sid: string; csrf: string }> {
    const sid = randomToken("ses_");
    const csrf = randomToken();
    const now = new Date().toISOString();
    await this.db.run(`INSERT INTO admin_sessions (id_hash, admin_id, csrf, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`, [
      await sha256Hex(sid), adminId, csrf, now, now,
    ]);
    return { sid, csrf };
  }

  async session(sid: string | undefined): Promise<{ adminId: string; csrf: string } | null> {
    if (!sid) return null;
    const h = await sha256Hex(sid);
    const row = await this.db.get<{ admin_id: string; csrf: string; last_seen_at: string }>(
      `SELECT admin_id, csrf, last_seen_at FROM admin_sessions WHERE id_hash = ?`,
      [h],
    );
    if (!row) return null;
    if (Date.now() - Date.parse(row.last_seen_at) > SESSION_IDLE_MS) {
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

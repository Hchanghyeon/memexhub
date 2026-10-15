/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import { exportBackup, importBackup } from "../core/backup.js";
import { audit } from "../core/audit.js";
import { importLedgerLines } from "../modules/ledger/import.js";
import { importHealthDays } from "../modules/health/import.js";

type Csrf = (p: { c: Context<any> }) => any;
const KINDS = ["all", "admin", "mcp", "dav", "ledger", "health", "system", "google-signin"] as const;

/** Activity log and backups. */
export function opsRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf, B: string) {
  const R = B || "/";

  app.get("/activity", async (c) => {
    const kind = (KINDS as readonly string[]).includes(c.req.query("who") ?? "") ? c.req.query("who")! : "all";
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const since = new Date(+hub.platform.now() - days * 86_400_000).toISOString();
    const rows = await hub.platform.db.all<{ at: string; actor: string; action: string; target: string | null; detail: string | null }>(
      `SELECT at, actor, action, target, detail FROM audit WHERE at >= ? ${kind === "all" ? "" : "AND (actor = ? OR actor LIKE ?)"} ORDER BY id DESC LIMIT 300`,
      kind === "all" ? [since] : [since, kind, `${kind}:%`],
    );
    return c.html(
      <Layout title="Activity — memexhub">
        <p><a href={R}>← Back</a></p>
        <h1>Activity</h1>
        <p class="muted">Who changed what: sign-ins, vault writes by Claude and devices, settings and connections. Contents and secrets are never logged.</p>
        <form method="get" action={`${B}/activity`}>
          <label>Who<select name="who">{KINDS.map((k) => <option value={k} selected={k === kind}>{k}</option>)}</select></label>
          <label>Last days<input name="days" type="number" min="1" max="90" value={String(days)} /></label>
          <button class="secondary">Show</button>
        </form>
        <table>
          <tr><th>When</th><th>Who</th><th>What</th><th>Target</th></tr>
          {rows.map((r) => (
            <tr><td>{r.at.slice(0, 16).replace("T", " ")}</td><td>{r.actor}</td><td>{r.action}</td><td>{r.target ?? ""}{r.detail ? <span class="muted"> {r.detail.slice(0, 80)}</span> : null}</td></tr>
          ))}
        </table>
        {!rows.length && <p class="muted">Nothing in this period.</p>}
      </Layout>,
    );
  });

  app.get("/import", async (c) => {
    const msg = { ok: c.req.query("ok"), err: c.req.query("err") };
    return c.html(
      <Layout title="Import — memexhub">
        <p><a href={R}>← Back</a></p>
        <h1>Import from a previous setup</h1>
        {msg.ok && <p class="ok">{msg.ok}</p>}
        {msg.err && <p class="err">{msg.err}</p>}
        <p class="muted">Importing the same file twice adds nothing. Notes are redrawn once at the end. See docs/migrating.md.</p>
        <h2>Payments</h2>
        <form method="post" action={`${B}/import/ledger`} enctype="multipart/form-data">
          <Csrf c={c} />
          <label>JSON Lines — one record per line with <code>time</code>, <code>merchant</code>, <code>amount</code>, <code>card</code> …<input type="file" name="file" accept=".jsonl,.json,.txt" required /></label>
          <button>Import payments</button>
        </form>
        <h2>Health</h2>
        <form method="post" action={`${B}/import/health`} enctype="multipart/form-data">
          <Csrf c={c} />
          <label>JSON — <code>{'{"2026-10-14": {"metrics": {...}, "sleep": {...}, "workouts": [...]}}'}</code><input type="file" name="file" accept=".json" required /></label>
          <button class="secondary">Import health</button>
        </form>
        <h2>Keep an existing device token</h2>
        <p class="muted">Your automations keep their token and only change the address. The token is stored hashed, like new ones.</p>
        <form method="post" action={`${B}/import/token`}>
          <Csrf c={c} />
          <label>Name<input name="name" required maxlength={40} /></label>
          <label>Existing token (at least 24 characters)<input name="token" type="password" required minlength={24} autocomplete="off" /></label>
          <label>Scopes (comma separated)<input name="scopes" value="ledger,health" /></label>
          <button class="secondary">Keep this token</button>
        </form>
      </Layout>,
    );
  });
  const done = (c: Context, k: "ok" | "err", m: string) => c.redirect(`${B}/import?${k}=${encodeURIComponent(m)}`);
  const upload = async (c: Context, max: number) => {
    const f = await c.req.parseBody();
    const file = f.file;
    if (!(file instanceof File) || file.size > max) return undefined;
    return file.text();
  };
  app.post("/import/ledger", async (c) => {
    const text = await upload(c, 50 * 1024 * 1024);
    if (text === undefined) return done(c, "err", "Choose a file (up to 50 MB).");
    const r = await importLedgerLines(hub.bus, text);
    await audit(hub.platform.db, `admin:${c.get("adminId")}`, "import.ledger", undefined, { added: r.added, skipped: r.skipped, invalid: r.invalid.length });
    return done(c, r.added || r.skipped ? "ok" : "err", `Added ${r.added} payments, skipped ${r.skipped} already present.${r.invalid.length ? ` Unreadable lines: ${r.invalid.join(", ")}.` : ""}`);
  });
  app.post("/import/health", async (c) => {
    const text = await upload(c, 50 * 1024 * 1024);
    if (text === undefined) return done(c, "err", "Choose a file (up to 50 MB).");
    try {
      const r = await importHealthDays(hub.bus, text);
      await audit(hub.platform.db, `admin:${c.get("adminId")}`, "import.health", undefined, { added: r.added });
      return done(c, "ok", `Imported ${r.added} days.`);
    } catch (e) {
      return done(c, "err", (e as Error).message.slice(0, 200));
    }
  });
  app.post("/import/token", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const token = String(f.token ?? "").trim();
    const scopes = String(f.scopes ?? "").split(",").map((x) => x.trim()).filter((x) => /^[a-z*]{1,20}$/.test(x)).slice(0, 10);
    if (token.length < 24 || token.length > 200 || !scopes.length || !String(f.name ?? "").trim()) return done(c, "err", "Give a name, a token of at least 24 characters and at least one scope.");
    if (await hub.ingestTokens.verify(token, scopes[0]!)) return done(c, "err", "That token is already known.");
    await hub.ingestTokens.importExisting(String(f.name).trim().slice(0, 40), token, scopes, `admin:${c.get("adminId")}`);
    return done(c, "ok", "Token kept. Point your automations at the new address.");
  });

  app.get("/backups", async (c) => {
    const list = (await hub.platform.backups?.list()) ?? [];
    const msg = { ok: c.req.query("ok"), err: c.req.query("err") };
    return c.html(
      <Layout title="Backups — memexhub">
        <p><a href={R}>← Back</a></p>
        <h1>Backups</h1>
        {msg.ok && <p class="ok">{msg.ok}</p>}
        {msg.err && <p class="err">{msg.err}</p>}
        <p>A backup holds settings, connections (secrets stay encrypted), tokens, records, the inbox and the activity log — encrypted with your <code>MEMEXHUB_SECRET</code>. Your vault notes are not in it; back the vault up with your sync or storage.</p>
        <form method="post" action={`${B}/backups/download`}><Csrf c={c} /><button>Download a backup now</button></form>
        <h2>Automatic daily copies</h2>
        {hub.platform.backups ? (
          list.length ? (
            <table><tr><th>File</th><th>Size</th></tr>{list.map((b) => <tr><td>{b.name}</td><td>{Math.ceil(b.size / 1024)} KB</td></tr>)}</table>
          ) : <p class="muted">The first copy is made within an hour. The newest 14 are kept in DATA_DIR/backups.</p>
        ) : <p class="muted">Not available on this runtime — download backups instead.</p>}
        <h2>Restore</h2>
        <p class="err">Restoring replaces all current settings, connections, tokens and records with the backup's. It cannot be undone.</p>
        <form method="post" action={`${B}/backups/restore`} enctype="multipart/form-data">
          <Csrf c={c} />
          <label>Backup file (.mxb)<input type="file" name="file" accept=".mxb" required /></label>
          <label>Type RESTORE to confirm<input name="confirm" required autocomplete="off" /></label>
          <button class="danger">Restore</button>
        </form>
      </Layout>,
    );
  });

  app.post("/backups/download", async (c) => {
    const now = hub.platform.now();
    await audit(hub.platform.db, `admin:${c.get("adminId")}`, "backup.download");
    c.header("content-disposition", `attachment; filename="memexhub-${now.toISOString().slice(0, 10)}.mxb"`);
    return c.body(await exportBackup(hub.platform.db, hub.platform.secret, now), 200, { "content-type": "application/octet-stream" });
  });

  app.post("/backups/restore", async (c) => {
    const f = await c.req.parseBody();
    const back = (k: "ok" | "err", m: string) => c.redirect(`${B}/backups?${k}=${encodeURIComponent(m)}`);
    if (String(f.confirm ?? "") !== "RESTORE") return back("err", "Type RESTORE to confirm.");
    const file = f.file;
    if (!(file instanceof File) || file.size > 200 * 1024 * 1024) return back("err", "Choose a backup file (.mxb).");
    try {
      const r = await importBackup(hub.platform.db, hub.platform.secret, await file.text());
      await audit(hub.platform.db, `admin:${c.get("adminId")}`, "backup.restore", undefined, { rows: r.rows, created: r.created });
      await hub.reload();
      return back("ok", `Restored ${r.rows} rows from the backup of ${r.created.slice(0, 16).replace("T", " ")}. Sign in again if asked.`);
    } catch (e) {
      return back("err", (e as Error).message.slice(0, 200));
    }
  });
}

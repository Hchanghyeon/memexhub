/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { pageFrame, when } from "./ui.js";
import { exportBackup, importBackup } from "../core/backup.js";
import { audit } from "../core/audit.js";
import { importLedgerLines } from "../modules/ledger/import.js";
import { importHealthDays } from "../modules/health/import.js";

type Csrf = (p: { c: Context<any> }) => any;
const KINDS = ["all", "admin", "mcp", "dav", "ledger", "health", "system", "google-signin"] as const;

/** Activity log and backups. */
export function opsRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf, B: string) {
  const frame = pageFrame(hub, B);

  app.get("/activity", async (c) => {
    const kind = (KINDS as readonly string[]).includes(c.req.query("who") ?? "") ? c.req.query("who")! : "all";
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const since = new Date(+hub.platform.now() - days * 86_400_000).toISOString();
    const rows = await hub.platform.db.all<{ at: string; actor: string; action: string; target: string | null; detail: string | null }>(
      `SELECT at, actor, action, target, detail FROM audit WHERE at >= ? ${kind === "all" ? "" : "AND (actor = ? OR actor LIKE ?)"} ORDER BY id DESC LIMIT 300`,
      kind === "all" ? [since] : [since, kind, `${kind}:%`],
    );
    const tz = (await hub.settings.get()).timezone;
    return frame(c, {
      title: ["Activity", "활동"],
      active: "/activity",
      children: (t) => (
        <>
          <h1>{t("Activity", "활동")}</h1>
          <p class="muted">{t("Who changed what: sign-ins, vault writes by Claude and devices, settings and connections. Contents and secrets are never logged.", "누가 무엇을 바꿨는지: 로그인, Claude와 기기의 볼트 쓰기, 설정과 연결. 내용과 비밀값은 남기지 않아요.")}</p>
          <form method="get" action={`${B}/activity`} class="row">
            <select name="who" style="flex:1;min-width:8rem;margin:0" aria-label={t("Who", "누가")}>{KINDS.map((k) => <option value={k} selected={k === kind}>{k === "all" ? t("everyone", "전체") : k}</option>)}</select>
            <input name="days" type="number" min="1" max="90" value={String(days)} style="width:6rem;margin:0" aria-label={t("Last days", "최근 며칠")} />
            <button class="secondary">{t("Show", "보기")}</button>
          </form>
          <div class="card" style="margin-top:1rem">
            {rows.length ? (
              <ul class="list">
                {rows.map((r) => (
                  <li style="display:block">
                    <span class="muted">{when(r.at, tz)} · {r.actor.length > 24 ? `${r.actor.slice(0, 24)}…` : r.actor}</span><br />
                    <b>{r.action}</b> {r.target ?? ""}{r.detail ? <span class="muted"> {r.detail.slice(0, 80)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p class="muted">{t("Nothing in this period.", "이 기간에는 없어요.")}</p>}
          </div>
        </>
      ),
    });
  });

  app.get("/import", async (c) => {
    return frame(c, {
      title: ["Import", "가져오기"],
      active: "/backups",
      children: (t) => (
        <>
          <p><a href={`${B}/backups`}>← {t("Backups", "백업")}</a></p>
          <h1>{t("Import from a previous setup", "예전 설정에서 가져오기")}</h1>
          <p class="muted">{t("Importing the same file twice adds nothing. Notes are redrawn once at the end. See docs/migrating.md.", "같은 파일을 두 번 가져와도 늘어나지 않아요. 노트는 끝에 한 번 다시 그려요. docs/migrating.md 참고.")}</p>
          <div class="card">
            <h2>{t("Payments", "결제")}</h2>
            <form method="post" action={`${B}/import/ledger`} enctype="multipart/form-data">
              <Csrf c={c} />
              <label>{t("JSON Lines — one record per line with time, merchant, amount, card …", "JSON Lines — 한 줄에 기록 하나 (time, merchant, amount, card …)")}<input type="file" name="file" accept=".jsonl,.json,.txt" required /></label>
              <button>{t("Import payments", "결제 가져오기")}</button>
            </form>
          </div>
          <div class="card">
            <h2>{t("Health", "건강")}</h2>
            <form method="post" action={`${B}/import/health`} enctype="multipart/form-data">
              <Csrf c={c} />
              <label>JSON — <code>{'{"2026-10-14": {"metrics": {...}, "sleep": {...}, "workouts": [...]}}'}</code><input type="file" name="file" accept=".json" required /></label>
              <button class="secondary">{t("Import health", "건강 가져오기")}</button>
            </form>
          </div>
          <div class="card">
            <h2>{t("Keep an existing device token", "쓰던 기기 토큰 유지")}</h2>
            <p class="muted">{t("Your automations keep their token and only change the address. The token is stored hashed, like new ones.", "자동화는 토큰을 그대로 두고 주소만 바꾸면 돼요. 토큰은 새 토큰처럼 해시로 저장해요.")}</p>
            <form method="post" action={`${B}/import/token`}>
              <Csrf c={c} />
              <label>{t("Name", "이름")}<input name="name" required maxlength={40} /></label>
              <label>{t("Existing token (at least 24 characters)", "쓰던 토큰 (24자 이상)")}<input name="token" type="password" required minlength={24} autocomplete="off" /></label>
              <label>{t("Scopes (comma separated)", "권한 (쉼표로 구분)")}<input name="scopes" value="ledger,health" /></label>
              <button class="secondary">{t("Keep this token", "이 토큰 유지")}</button>
            </form>
          </div>
        </>
      ),
    });
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
    return frame(c, {
      title: ["Backups", "백업"],
      active: "/backups",
      children: (t) => (
        <>
          <h1>{t("Backups", "백업")}</h1>
          <div class="card">
            <p>{t("A backup holds settings, connections (secrets stay encrypted), tokens, records, the inbox and the activity log — encrypted with your MEMEXHUB_SECRET. Vault notes are not in it; back the vault up with your sync or storage.", "백업에는 설정, 연결(비밀값은 암호화된 채), 토큰, 기록, 대기함, 활동 기록이 들어가고 MEMEXHUB_SECRET으로 암호화돼요. 볼트 노트는 들어가지 않아요. 볼트는 동기화나 저장소로 백업하세요.")}</p>
            <form method="post" action={`${B}/backups/download`}><Csrf c={c} /><button>{t("Download a backup now", "지금 백업 내려받기")}</button></form>
          </div>
          <div class="card">
            <h2>{t("Automatic daily copies", "매일 자동 백업")}</h2>
            {hub.platform.backups ? (
              list.length ? (
                <ul class="list">{list.map((b) => <li><span style="flex:1">{b.name}</span><span class="muted">{Math.ceil(b.size / 1024)} KB</span></li>)}</ul>
              ) : <p class="muted">{t("The first copy is made within an hour. The newest 14 are kept in DATA_DIR/backups.", "첫 백업은 한 시간 안에 만들어져요. 최근 14개를 DATA_DIR/backups에 남겨요.")}</p>
            ) : <p class="muted">{t("Not available on this runtime — download backups instead.", "이 실행 환경에서는 안 돼요. 내려받기를 쓰세요.")}</p>}
          </div>
          <div class="card">
            <h2>{t("Move from another setup", "다른 설정에서 옮기기")}</h2>
            <p><a href={`${B}/import`}>{t("Import payments, health or a device token", "결제·건강·기기 토큰 가져오기")} →</a></p>
          </div>
          <div class="card">
            <h2>{t("Restore", "복원")}</h2>
            <p class="err">{t("Restoring replaces all current settings, connections, tokens and records with the backup's. It cannot be undone.", "복원하면 지금의 설정, 연결, 토큰, 기록이 모두 백업 내용으로 바뀌어요. 되돌릴 수 없어요.")}</p>
            <details>
              <summary>{t("Restore from a file", "파일에서 복원")}</summary>
              <form method="post" action={`${B}/backups/restore`} enctype="multipart/form-data">
                <Csrf c={c} />
                <label>{t("Backup file (.mxb)", "백업 파일 (.mxb)")}<input type="file" name="file" accept=".mxb" required /></label>
                <label>{t("Type RESTORE to confirm", "확인하려면 RESTORE 입력")}<input name="confirm" required autocomplete="off" /></label>
                <button class="danger">{t("Restore", "복원")}</button>
              </form>
            </details>
          </div>
        </>
      ),
    });
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

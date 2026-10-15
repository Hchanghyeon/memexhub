import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { summaryTools } from "./summary-tools.js";
import { exportBackup } from "../../core/backup.js";

export default defineModule({
  id: "hub",
  title: T("Hub status", "허브 상태"),
  setup: (ctx) => ({
    jobs: [
      {
        // Housekeeping: expired one-time codes, long-expired tokens and idle sessions don't stay in the database.
        id: "auth-cleanup",
        everyMinutes: 360,
        run: async () => {
          const now = +ctx.platform.now();
          const iso = (ms: number) => new Date(now - ms).toISOString();
          await ctx.platform.db.batch([
            { sql: `DELETE FROM oauth_codes WHERE expires_at < ?`, params: [iso(86_400_000)] },
            { sql: `DELETE FROM oauth_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, params: [iso(30 * 86_400_000), iso(30 * 86_400_000)] },
            { sql: `DELETE FROM admin_sessions WHERE last_seen_at < ?`, params: [iso(30 * 86_400_000)] },
          ]);
        },
      },
      ...(ctx.platform.backups
      ? [
          {
            // Daily encrypted copy of the database in DATA_DIR/backups; the newest 14 are kept.
            id: "daily-backup",
            everyMinutes: 60,
            run: async () => {
              const store = ctx.platform.backups!;
              const last = (await store.list())[0];
              if (last && +ctx.platform.now() - +last.created < 20 * 3600_000) return;
              const now = ctx.platform.now();
              await store.save(`memexhub-${now.toISOString().replace(/[:.]/g, "-")}.mxb`, await exportBackup(ctx.platform.db, ctx.platform.secret, now));
              await store.prune(14);
            },
          },
        ]
      : []),
    ],
    tools: [
      ...summaryTools(ctx),
      defineTool({
        name: "hub_status",
        readOnly: true,
        description: T(
          "Health of memexhub: connections, last received records, vault mode. Never shows secrets or settings values.",
          "memexhub 상태 — 연결 상태, 마지막 수신, 볼트 모드. 비밀값이나 설정값은 보여 주지 않는다.",
        ),
        input: {},
        async run() {
          const db = ctx.platform.db;
          const conns = await db.all<any>(`SELECT kind, name, provider, status, last_ok_at FROM connections WHERE enabled = 1`);
          const last = await db.all<any>(`SELECT type, MAX(received_at) at, COUNT(*) n FROM events WHERE skipped IS NULL GROUP BY type`);
          return [
            "connections:",
            ...conns.map((c) => `- ${c.kind}/${c.name} (${c.provider}) ${c.status ?? "unknown"}${c.last_ok_at ? ` · ok ${c.last_ok_at.slice(0, 16)}` : ""}`),
            "records:",
            ...last.map((l) => `- ${l.type}: ${l.n} · last ${String(l.at).slice(0, 16)}`),
          ].join("\n");
        },
      }),
    ],
  }),
});

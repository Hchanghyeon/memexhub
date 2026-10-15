import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";

export default defineModule({
  id: "hub",
  title: T("Hub status", "허브 상태"),
  setup: ({ platform }) => ({
    tools: [
      defineTool({
        name: "hub_status",
        readOnly: true,
        description: T(
          "Health of memexhub: connections, last received records, vault mode. Never shows secrets or settings values.",
          "memexhub 상태 — 연결 상태, 마지막 수신, 볼트 모드. 비밀값이나 설정값은 보여 주지 않는다.",
        ),
        input: {},
        async run() {
          const db = platform.db;
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

import { defineModule } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { sha256Hex } from "../../core/crypto.js";
import { Cursors } from "../../core/cursors.js";
import { zonedIso } from "../../core/time.js";
import type { NotionClient, NotionProps } from "../../providers/notion/client.js";
import { entries, krw, type LedgerRow } from "../ledger/render.js";
import { dayLine, mergeDays } from "../health/render.js";
import type { DayUpdate } from "../health/parse.js";

const text = (s: string) => ({ rich_text: s ? [{ type: "text", text: { content: s.slice(0, 2000) } }] : [] });
const title = (s: string) => ({ title: [{ type: "text", text: { content: (s || "—").slice(0, 2000) } }] });

const SCHEMAS = {
  ledger: {
    title: "memexhub · Payments",
    properties: {
      Merchant: { title: {} }, Date: { date: {} }, Amount: { number: { format: "number" } }, "Amount (text)": { rich_text: {} },
      Card: { rich_text: {} }, Place: { rich_text: {} }, Item: { rich_text: {} }, Online: { checkbox: {} },
      Kind: { select: { options: [{ name: "payment" }, { name: "transit" }, { name: "office" }] } },
    },
  },
  health: {
    title: "memexhub · Health",
    properties: {
      Day: { title: {} }, Date: { date: {} }, Steps: { number: { format: "number" } }, "Sleep (h)": { number: { format: "number" } },
      "Resting HR": { number: { format: "number" } }, "Active kcal": { number: { format: "number" } }, Workouts: { rich_text: {} }, Summary: { rich_text: {} },
    },
  },
} as const;
type Kind = keyof typeof SCHEMAS;
export interface NotionSyncResult { kind: Kind; created: number; updated: number; unchanged: number; more: boolean }
const MAX_PER_RUN = 500;

/**
 * Output sink: mirrors payments and health into Notion databases. The engine's events stay the source of truth;
 * notion_rows remembers which page mirrors which record, so a re-sync only creates what is new and updates what changed.
 */
export default defineModule({
  id: "notion",
  title: T("Notion", "Notion"),
  setup: ({ settings, provider, platform, bus }) => {
    const db = platform.db;
    const cursors = new Cursors(db, () => platform.now());
    const s = () => settings.notion;

    const rowsOf = async (kind: Kind): Promise<{ key: string; props: NotionProps }[]> => {
      const tz = settings.timezone;
      if (kind === "ledger") {
        const raw: LedgerRow[] = (await bus.query(["ledger"], { includeSkipped: true })).map((e) => ({ id: e.id, time: e.occurredAt, skipped: e.skipped, ...(e.payload as object) }));
        return entries(raw, tz, settings.ledger.officePlaces).map((e) => ({
          key: e.id ?? e.time,
          props: {
            Merchant: title(e.merchant || e.name || ""),
            Date: { date: { start: zonedIso(tz, e.w.y, e.w.m, e.w.d, e.w.h, e.w.mi) } },
            Amount: { number: krw(e.amount) },
            "Amount (text)": text(e.amount ?? ""),
            Card: text(e.card ?? ""),
            Place: text(e.online ? "" : (e.place ?? "")),
            Item: text(e.item ?? ""),
            Online: { checkbox: !!e.online },
            Kind: { select: { name: e.kind2 === "pay" ? "payment" : e.kind2 } },
          },
        }));
      }
      const days = mergeDays((await bus.query(["health"])).map((e) => e.payload as { date: string; update: DayUpdate }));
      return [...days].map(([date, r]) => ({
        key: date,
        props: {
          Day: title(date),
          Date: { date: { start: date } },
          Steps: { number: r.metrics.steps ?? null },
          "Sleep (h)": { number: r.sleep ? Math.round(((r.sleep.asleep_min ?? r.sleep.bed_min ?? 0) / 60) * 10) / 10 : null },
          "Resting HR": { number: r.metrics.resting_hr ?? null },
          "Active kcal": { number: r.metrics.active_kcal ?? null },
          Workouts: text((r.workouts ?? []).map((w) => `${w.type}${w.min ? ` ${w.min} min` : ""}`).join(", ")),
          Summary: text(dayLine(date, r, settings.health.language).replace(/^- /, "")),
        },
      }));
    };

    const sync = async (): Promise<NotionSyncResult[]> => {
      const kinds = (["ledger", "health"] as Kind[]).filter((k) => s()[k]);
      if (!kinds.length) return [];
      const n = await provider<NotionClient>("notion", s().connection);
      if (!n) throw new Error("no Notion connection — admin UI → Connections");
      const out: NotionSyncResult[] = [];
      for (const kind of kinds) {
        const key = `notion.db:${kind}`;
        let target = await cursors.get<{ databaseId: string; dataSourceId: string }>(key);
        if (!target) {
          target = await n.createDatabase(SCHEMAS[kind].title, SCHEMAS[kind].properties as NotionProps);
          await cursors.set(key, target);
        }
        const res: NotionSyncResult = { kind, created: 0, updated: 0, unchanged: 0, more: false };
        let work = 0;
        for (const row of await rowsOf(kind)) {
          const hash = (await sha256Hex(JSON.stringify(row.props))).slice(0, 32);
          const have = await db.get<{ page_id: string; hash: string }>(`SELECT page_id, hash FROM notion_rows WHERE kind = ? AND key = ?`, [kind, row.key]);
          if (have?.hash === hash) {
            res.unchanged++;
            continue;
          }
          if (work++ >= MAX_PER_RUN) {
            res.more = true;
            break;
          }
          if (have) {
            await n.updateRow(have.page_id, row.props);
            await db.run(`UPDATE notion_rows SET hash = ? WHERE kind = ? AND key = ?`, [hash, kind, row.key]);
            res.updated++;
          } else {
            const pageId = await n.createRow(target.dataSourceId, row.props);
            await db.run(`INSERT INTO notion_rows (kind, key, page_id, hash) VALUES (?, ?, ?, ?)`, [kind, row.key, pageId, hash]);
            res.created++;
          }
        }
        out.push(res);
      }
      return out;
    };

    return {
      admin: { sync },
      jobs: s().ledger || s().health ? [{ id: "notion-sync", everyMinutes: 15, run: async () => void (await sync()) }] : [],
    };
  },
});

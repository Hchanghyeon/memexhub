import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Ledger, TransactionInput } from "./record.js";
import { MessageInput } from "./messages/types.js";
import { MessageReader, loadRecipes } from "./messages/reader.js";
import { builtinSource } from "./messages/builtin.js";
import { moneySkeleton, renderMoney, renderPaymentsBody, renderPaymentsNote, replaceAutoSection, type LedgerRow } from "./render.js";
import { nowIn } from "../../core/time.js";

export default defineModule({
  id: "ledger",
  title: T("Ledger", "결제"),
  setup: ({ settings, bus, vault, platform }) => {
    const ledger = new Ledger(bus, { officePlaces: settings.ledger.officePlaces });
    const tz = settings.timezone;
    const opts = () => ({ tz, officePlaces: settings.ledger.officePlaces, lang: settings.ledger.language, now: platform.now() });
    const rows = async (): Promise<LedgerRow[]> =>
      (await bus.query(["ledger"], { includeSkipped: true })).map((e) => ({ id: e.id, time: e.occurredAt, skipped: e.skipped, ...(e.payload as object) }));

    /** Observer: every recorded fact redraws the notes it affects. Rendering failures never lose a record. */
    const redraw = async (years?: number[]) => {
      if (!vault) return;
      const all = await rows();
      const ys = years ?? [...new Set(all.map((r) => nowIn(tz, new Date(r.time)).y))];
      const w = vault.withActor("ledger");
      for (const y of ys) await w.write(settings.ledger.paymentsNote.replace("{year}", String(y)), renderPaymentsNote(all, y, opts()));
      const moneyPath = settings.ledger.moneyNote;
      const now = nowIn(tz, platform.now());
      const today = `${now.y}-${String(now.m).padStart(2, "0")}-${String(now.d).padStart(2, "0")}`;
      const current = (await vault.stat(moneyPath)) ? (await vault.read(moneyPath)).text : moneySkeleton(settings.ledger.language, `[[${settings.ledger.paymentsNote.replace("{year}", String(now.y)).replace(/\.md$/, "")}]]`, today);
      await w.write(moneyPath, replaceAutoSection(current, renderMoney(all, opts())).replace(/^updated: .*$/m, `updated: ${today}`));
    };
    bus.on("ledger", async (e) => {
      try {
        await redraw([nowIn(tz, new Date(e.occurredAt)).y]);
      } catch (err) {
        platform.log.warn("ledger redraw failed", { error: (err as Error).message.slice(0, 120) });
      }
    });
    const recipes = loadRecipes([builtinSource]);
    const reader = new MessageReader(async () => (await recipes).active, { tz: () => settings.timezone, now: () => platform.now() });
    const keysOf = (b: unknown) => (b && typeof b === "object" ? Object.keys(b as object) : []);
    return {
      tools: [
        defineTool({
          name: "payments_day",
          readOnly: true,
          description: T(
            "One day's payments, totals, transit taps and office gate taps — compact. Use instead of opening the yearly payments note.",
            "하루치 결제, 합계, 교통 태그, 회사 출입을 짧게. 연간 결제 노트를 여는 대신 쓴다.",
          ),
          input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD") },
          async run({ date }) {
            const [y, m, d] = date.split("-").map(Number) as [number, number, number];
            const all = await rows();
            const merges = all.filter((r) => r.skipped === "merged");
            const day = all.filter((r) => {
              if (r.skipped) return false;
              const p = nowIn(tz, new Date(r.time));
              return p.y === y && p.m === m && p.d === d;
            });
            if (!day.length) return `no ledger records on ${date}`;
            return renderPaymentsBody([...day, ...merges], y, opts()).replace(/^## .*\n\n/, "");
          },
        }),
      ],
      ingest: [
        {
          path: "/ingest/transaction",
          scope: "ledger",
          maxBytes: 4096,
          async handle(body) {
            const p = TransactionInput.safeParse(body);
            if (!p.success) {
              await ledger.reject("/ingest/transaction", "invalid payload", keysOf(body));
              throw new Error("invalid payload");
            }
            return ledger.record(p.data);
          },
        },
        {
          path: "/ingest/message",
          scope: "ledger",
          maxBytes: 20_480,
          async handle(body) {
            const p = MessageInput.safeParse(body);
            if (!p.success) {
              await ledger.reject("/ingest/message", "invalid payload", keysOf(body));
              throw new Error("invalid payload");
            }
            const m = p.data;
            const r = await reader.read(m);
            if (r.kind === "ignore") return { kind: "ignored", recipe: r.recipeId };
            if (!r.confident || !r.payment) {
              // The inbox (#38) will keep these for Claude; until then they are rejected without storing the text.
              await ledger.reject("/ingest/message", r.reason ?? "unreadable", keysOf(body));
              throw new Error(r.reason ?? "unreadable");
            }
            const input = { ...r.payment, lat: m.lat, lon: m.lon, source: m.channel };
            return r.kind === "item" ? ledger.attachOrRecord(input) : ledger.record(input);
          },
        },
      ],
    };
  },
});

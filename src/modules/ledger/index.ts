import { z } from "zod";
import { defineModule } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Ledger, TransactionInput } from "./record.js";
import { parseCardSms, SmsParseError } from "./sms.js";
import { moneySkeleton, renderMoney, renderPaymentsNote, replaceAutoSection, type LedgerRow } from "./render.js";
import { nowIn } from "../../core/time.js";

const SmsInput = z.object({ text: z.string().min(1).max(2000), lat: z.coerce.number().optional(), lon: z.coerce.number().optional() }).strict();

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
    const keysOf = (b: unknown) => (b && typeof b === "object" ? Object.keys(b as object) : []);
    return {
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
          path: "/ingest/sms",
          scope: "ledger",
          maxBytes: 4096,
          async handle(body) {
            const p = SmsInput.safeParse(body);
            if (!p.success) {
              await ledger.reject("/ingest/sms", "invalid payload", keysOf(body));
              throw new Error("invalid payload");
            }
            try {
              const parsed = parseCardSms(p.data.text, { tz: settings.timezone });
              return await ledger.record({ ...parsed, lat: p.data.lat, lon: p.data.lon });
            } catch (e) {
              if (e instanceof SmsParseError) {
                await ledger.reject("/ingest/sms", e.message, keysOf(body));
                throw new Error(e.message);
              }
              throw e;
            }
          },
        },
      ],
    };
  },
});

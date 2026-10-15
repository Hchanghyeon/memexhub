import { z } from "zod";
import { defineModule } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Ledger, TransactionInput } from "./record.js";
import { parseCardSms, SmsParseError } from "./sms.js";

const SmsInput = z.object({ text: z.string().min(1).max(2000), lat: z.coerce.number().optional(), lon: z.coerce.number().optional() }).strict();

export default defineModule({
  id: "ledger",
  title: T("Ledger", "결제"),
  setup: ({ settings, bus }) => {
    const ledger = new Ledger(bus, { officePlaces: settings.ledger.officePlaces });
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

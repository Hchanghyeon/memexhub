import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Ledger, TransactionInput } from "./record.js";
import { MessageInput } from "./messages/types.js";
import { MessageReader, loadRecipes } from "./messages/reader.js";
import { builtinSource } from "./messages/builtin.js";
import { vaultRecipeSource } from "./messages/notes.js";
import { Layout } from "../wiki/layout.js";
import { moneySkeleton, renderMoney, renderPaymentsBody, renderPaymentsNote, replaceAutoSection, type LedgerRow } from "./render.js";
import { nowIn } from "../../core/time.js";
import { Inbox } from "../../core/inbox.js";
import { inboxTools, type PendingMessage } from "./inbox-tools.js";
import { ledgerAdmin } from "./admin-api.js";
import { syncReceiptMails } from "./mail-job.js";
import { Cursors } from "../../core/cursors.js";
import type { MailProvider } from "../../providers/mail/types.js";
import type { Geocoder, LocationProvider } from "../../providers/location/types.js";
import { placeResolver } from "../location/places.js";

export default defineModule({
  id: "ledger",
  title: T("Ledger", "결제"),
  setup: ({ settings, bus, vault, platform, provider }) => {
    // Payment places come from the location module's sources (if connected): coordinates → a name, or the place at that time.
    const places = placeResolver(
      async () => ({
        loc: await provider<LocationProvider>("location", settings.location.connection).catch(() => undefined),
        geo: await provider<Geocoder>("geocoder", settings.location.geocoder).catch(() => undefined),
      }),
      { privateAreas: () => settings.location.privateAreas, now: () => +platform.now() },
    );
    const ledger = new Ledger(bus, { officePlaces: settings.ledger.officePlaces, places, now: () => platform.now() });
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
    // Built-in recipes, overridden by recipe notes in the vault; recompiled only when a note changed.
    const recipesDir = new Layout(settings.wiki.roles).recipes;
    const vaultRecipes = vaultRecipeSource(() => vault, () => recipesDir);
    let loaded: { sig: string; result: ReturnType<typeof loadRecipes> } | undefined;
    const recipes = async () => {
      const sig = await vaultRecipes.signature();
      if (loaded?.sig !== sig) loaded = { sig, result: loadRecipes([builtinSource, vaultRecipes]) };
      return loaded.result;
    };
    const reader = new MessageReader(async () => (await recipes()).active, { tz: () => settings.timezone, now: () => platform.now() });
    const inbox = new Inbox(platform.db, platform.secret, () => platform.now());
    const extra = inboxTools({
      inbox, ledger, vault: () => vault, recipesDir, recipes,
      tz: () => settings.timezone, now: () => platform.now(), inboxDays: () => settings.ledger.inboxDays,
    });
    const keysOf = (b: unknown) => (b && typeof b === "object" ? Object.keys(b as object) : []);
    const mailSync = (o?: { since?: string; until?: string }) =>
      syncReceiptMails({
        sources: () => settings.ledger.mailSources, provider: (name) => provider<MailProvider>("mail", name),
        reader, ledger, inbox, cursors: new Cursors(platform.db, () => platform.now()), tz: () => settings.timezone, now: () => platform.now(),
      }, o);
    return {
      admin: ledgerAdmin({ vault: () => vault, recipesDir, recipes, reader, inbox, ledger, tz: () => settings.timezone, now: () => platform.now() }),
      jobs: [
        ...extra.jobs,
        ...(settings.ledger.mailSources.length ? [{ id: "ledger-receipt-mails", everyMinutes: 15, run: async () => void (await mailSync()) }] : []),
      ],
      tools: [
        ...extra.tools,
        defineTool({
          name: "payments_from_mail",
          readOnly: false,
          description: T(
            "Read the receipt-mail folders set in the admin UI now (normally every 15 minutes) and record what the recipes recognise: receipts add the item name to the matching card payment, or become a payment. Each mail is read only once. Optional date range (YYYY-MM-DD) to look further back.",
            "관리 화면에 정한 결제 메일 폴더를 지금 읽는다(평소엔 15분마다). 레시피가 알아보는 메일만 기록 — 영수증은 같은 카드 결제에 품목을 붙이거나 새 결제가 된다. 같은 메일은 한 번만. 더 예전을 보려면 날짜(YYYY-MM-DD) 범위.",
          ),
          input: {
            since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          },
          async run({ since, until }) {
            if (!settings.ledger.mailSources.length) return "no receipt-mail folders set — admin UI → Features → Ledger";
            const r = await mailSync({ since, until });
            return [
              `read ${r.read} new mails: ${r.recorded} recorded · ${r.attached} items attached · ${r.pending} to the inbox · ${r.ignored} ignored · ${r.skipped} not payments`,
              ...r.problems.map((p) => `! ${p}`),
            ].join("\n");
          },
        }),
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
              // Payment-like but unsure → inbox (encrypted) for Claude or the admin. No amount at all → rejected, nothing kept.
              if (r.payment?.amount) {
                const data: PendingMessage = { message: { channel: m.channel, from: m.from, subject: m.subject, text: m.text, time: m.time }, guess: r.payment, step: r.step };
                return { kind: "pending", inbox: await inbox.add("ledger", m.channel ?? "text", r.reason ?? "unreadable", data) };
              }
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

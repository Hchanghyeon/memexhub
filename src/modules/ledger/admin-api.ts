import { monthReport, type MonthReport } from "./month.js";
import type { LedgerRow } from "./render.js";
import { nowIn } from "../../core/time.js";
import type { Inbox } from "../../core/inbox.js";
import type { SafeVault } from "../../storage/safe-vault.js";
import type { Ledger } from "./record.js";
import type { PendingMessage } from "./inbox-tools.js";
import type { Message, ReadPayment, ReadResult } from "./messages/types.js";
import { MessageReader, loadRecipes } from "./messages/reader.js";
import { compileRecipe, type CompiledRecipe } from "./messages/recipe.js";
import { genericRead } from "./messages/generic.js";
import { notesIn, parseRecipeNote, recipeNote, vaultRecipeSource } from "./messages/notes.js";
import { BUILTIN_RECIPES } from "./messages/builtin.js";

type Loaded = { active: CompiledRecipe[]; errors: { id: string; source: string; path?: string; error: string }[] };

/** Ledger actions for the admin UI. Writes to active recipes go through SafeVault.confirmedByAdmin(). */
export interface LedgerAdmin {
  recipesDir: string;
  read(m: Message): Promise<ReadResult>;
  recipes(): Promise<Loaded & { proposed: Loaded & { files: string[] } }>;
  approve(file: string): Promise<string>;
  disable(id: string): Promise<string>;
  draft(m: Message): Promise<string>;
  saveProposal(json: string): Promise<string>;
  importPack(json: string): Promise<string>;
  exportPack(): Promise<string>;
  inbox(): Promise<{ id: string; receivedAt: string; channel: string; reason: string; data?: PendingMessage }[]>;
  resolve(id: string, action: "record" | "ignore", fields: Partial<ReadPayment>): Promise<string>;
  /** Record a waiting message and, from it, make a recipe so the same sender is read by itself next time. */
  learn(id: string, fields: Partial<ReadPayment>): Promise<{ recorded: string; learned: boolean; name?: string; reason?: string }>;
  /** Never ask about this sender again: an "ignore" recipe on its address, and its other waiting messages closed. */
  ignoreSender(id: string): Promise<{ sender: string; closed: number }>;
  /** One month of payments for the money page. */
  month(year: number, month: number): Promise<MonthReport>;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "sender";

export function ledgerAdmin(d: {
  vault: () => SafeVault | undefined;
  recipesDir: string;
  recipes: () => Promise<Loaded>;
  reader: MessageReader;
  inbox: Inbox;
  ledger: Ledger;
  tz: () => string;
  now: () => Date;
  rows: () => Promise<LedgerRow[]>;
  officePlaces: () => string[];
}): LedgerAdmin {
  const admin = () => {
    const v = d.vault();
    if (!v) throw new Error("Connect a vault first: recipes are stored as notes.");
    return v.confirmedByAdmin("admin");
  };
  const proposedDir = `${d.recipesDir}/proposed`;
  const writeProposal = async (raw: Record<string, unknown>) => {
    const c = compileRecipe(raw);
    const path = `${proposedDir}/${c.recipe.id}.md`;
    await admin().write(path, recipeNote(raw));
    return path;
  };
  return {
    recipesDir: d.recipesDir,
    read: (m) => d.reader.read(m),
    async recipes() {
      const loaded = await d.recipes();
      const v = d.vault();
      const files = v ? notesIn(await v.list(proposedDir).catch(() => []), proposedDir).map((f) => f.path) : [];
      const proposed = await loadRecipes([vaultRecipeSource(d.vault, () => d.recipesDir, "proposed")]);
      return { ...loaded, proposed: { ...proposed, files } };
    },
    async approve(file) {
      if (!file.startsWith(`${proposedDir}/`) || file.slice(proposedDir.length + 1).includes("/")) throw new Error("not a proposal");
      const v = admin();
      const text = (await v.read(file)).text;
      const parsed = parseRecipeNote(text);
      const failed = (await loadRecipes([{ id: "check", list: () => [parsed] }])).errors;
      if (failed.length) throw new Error(`Cannot approve: ${failed[0]!.error}`);
      const target = `${d.recipesDir}/${file.slice(proposedDir.length + 1)}`;
      await v.write(target, text);
      await v.trash(file);
      return `Approved. ${target} is now active.`;
    },
    async disable(id) {
      const v = admin();
      const { active } = await d.recipes();
      const c = active.find((x) => x.recipe.id === id);
      if (!c) throw new Error("No active recipe with that id.");
      if (c.path) {
        const raw = parseRecipeNote((await v.read(c.path)).text);
        await v.write(c.path, recipeNote({ ...raw, enabled: false }));
        return `Disabled ${id} (${c.path}).`;
      }
      const builtin = BUILTIN_RECIPES.find((r) => (r as { id?: string }).id === id) as Record<string, unknown> | undefined;
      if (!builtin) throw new Error("Unknown recipe.");
      const path = `${d.recipesDir}/${id}.md`;
      await v.write(path, recipeNote({ ...builtin, enabled: false }, "Switches the built-in recipe off. Delete this note (or set enabled to true) to switch it back on."));
      return `Disabled built-in ${id} with ${path}.`;
    },
    async draft(m) {
      const g = genericRead(m.text, { tz: d.tz(), now: d.now() });
      const firstLine = m.text.replace(/\[Web발신\]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      // The sender's name: the card word, else the first line without amounts, dates and numbers (they change every time).
      const key = (g.cardWord || firstLine.replace(/[\d][\d,./:]*\s*원?/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ")).slice(0, 20);
      const recipe = {
        id: `custom.${slug(g.cardWord ? g.cardWord.replace(/카드$/, "") : key)}.${m.channel ?? "sms"}`,
        name: key || "New recipe",
        channels: [m.channel ?? "sms"],
        match: { any: [esc(key || "?")], ...(/승인|취소/.test(m.text) ? { all: ["승인|취소"] } : {}) },
        set: { card: g.cardWord || key },
        examples: [{ text: m.text, expect: { amount: g.amount, ...(g.merchant ? { merchant: g.merchant } : {}) } }],
      };
      return JSON.stringify(recipe, null, 2);
    },
    async saveProposal(json) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(json);
      } catch (e) {
        throw new Error(`Not valid JSON: ${(e as Error).message.slice(0, 120)}`);
      }
      const failed = (await loadRecipes([{ id: "check", list: () => [raw] }])).errors;
      if (failed.length) throw new Error(failed[0]!.error);
      return `Saved ${await writeProposal(raw)}. Approve it below to use it.`;
    },
    async importPack(json) {
      let list: unknown;
      try {
        list = JSON.parse(json);
      } catch (e) {
        throw new Error(`Not valid JSON: ${(e as Error).message.slice(0, 120)}`);
      }
      const items = (Array.isArray(list) ? list : [list]).slice(0, 100);
      const ok: string[] = [];
      const bad: string[] = [];
      for (const raw of items) {
        const failed = (await loadRecipes([{ id: "check", list: () => [raw] }])).errors;
        if (failed.length) bad.push(`${failed[0]!.id}: ${failed[0]!.error}`);
        else ok.push(await writeProposal(raw as Record<string, unknown>));
      }
      return `Imported ${ok.length} as proposals${bad.length ? `; skipped ${bad.length}: ${bad.join(" · ")}` : ""}.`;
    },
    async exportPack() {
      const { active } = await d.recipes();
      return JSON.stringify(active.map((c) => c.recipe), null, 2);
    },
    async inbox() {
      return (await d.inbox.list<PendingMessage>("ledger", { limit: 100 })).map((i) => ({ id: i.id, receivedAt: i.receivedAt, channel: i.channel, reason: i.reason, data: i.data }));
    },
    async resolve(id, action, fields) {
      const it = await d.inbox.get<PendingMessage>("ledger", id);
      if (!it?.data || it.status !== "pending") throw new Error("This item is no longer pending.");
      if (action === "ignore") {
        await d.inbox.close("ledger", id, "ignored");
        return "Ignored.";
      }
      const p = { ...it.data.guess, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) } as Partial<ReadPayment>;
      if (!p.amount || !/^-?(₩[\d,]+|[A-Z]{3} [\d,.]+)$/.test(p.amount)) throw new Error("Amount must look like ₩12,500 (or -₩8,000 for a cancellation).");
      const r = await d.ledger.record({ merchant: p.merchant, amount: p.amount, card: p.card, time: p.time || it.data.message.time || it.receivedAt, item: p.item, source: it.channel });
      await d.inbox.close("ledger", id, "resolved");
      return `Recorded as ${r.kind}${r.duplicate ? " (same amount within 5 minutes: kept as a duplicate)" : ""}.`;
    },
    async learn(id, fields) {
      const it = await d.inbox.get<PendingMessage>("ledger", id);
      if (!it?.data || it.status !== "pending") throw new Error("This item is no longer pending.");
      const m = it.data.message;
      const p = { ...it.data.guess, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) } as Partial<ReadPayment>;
      const recorded = await this.resolve(id, "record", fields);
      try {
        const raw = JSON.parse(await this.draft({ channel: m.channel ?? "sms", text: m.text, from: m.from, subject: m.subject } as Message)) as Record<string, unknown>;
        // The owner's values are the truth: the recipe must read this very message the same way.
        const g = genericRead(m.text, { tz: d.tz(), now: d.now() });
        // A merchant the reader finds by itself is checked; one that is the sender's own name (a pay service) is set.
        const fixedMerchant = p.merchant && !g.merchant && String(raw.name ?? "").includes(p.merchant) ? p.merchant : undefined;
        raw.set = { ...(raw.set as object), ...(p.card ? { card: p.card } : {}), ...(fixedMerchant ? { merchant: fixedMerchant } : {}) };
        raw.examples = [{ text: m.text, expect: { amount: p.amount, ...(p.merchant && (g.merchant === p.merchant || fixedMerchant) ? { merchant: p.merchant } : {}) } }];
        const failed = (await loadRecipes([{ id: "check", list: () => [raw] }])).errors;
        if (failed.length) return { recorded, learned: false, reason: failed[0]!.error };
        await this.approve(await writeProposal(raw));
        return { recorded, learned: true, name: String(raw.name ?? raw.id) };
      } catch (e) {
        return { recorded, learned: false, reason: (e as Error).message.slice(0, 200) };
      }
    },
    async month(year, month) {
      return monthReport(await d.rows(), { tz: d.tz(), officePlaces: d.officePlaces(), year, month, today: nowIn(d.tz(), d.now()) });
    },
    async ignoreSender(id) {
      const it = await d.inbox.get<PendingMessage>("ledger", id);
      if (!it?.data || it.status !== "pending") throw new Error("This item is no longer pending.");
      const m = it.data.message;
      // The address inside <…>, else the whole sender (an SMS number or a bare address).
      const sender = (m.from?.match(/<([^<>\s]+)>/)?.[1] ?? m.from ?? "").trim().slice(0, 120);
      if (!sender) throw new Error("This message has no sender to ignore.");
      const channel = m.channel ?? "sms";
      const raw = { id: `custom.ignore.${slug(sender)}.${channel}`, name: `${sender} (not payments)`, channels: [channel], match: { from: esc(sender) }, kind: "ignore" };
      const failed = (await loadRecipes([{ id: "check", list: () => [raw] }])).errors;
      if (failed.length) throw new Error(failed[0]!.error);
      await this.approve(await writeProposal(raw));
      let closed = 0;
      for (const other of await d.inbox.list<PendingMessage>("ledger", { status: "pending", limit: 200 })) {
        const o = other.data?.message;
        if (other.id === id || (o && (o.channel ?? "sms") === channel && (o.from ?? "").includes(sender))) {
          await d.inbox.close("ledger", other.id, "ignored");
          closed++;
        }
      }
      return { sender, closed };
    },
  };
}

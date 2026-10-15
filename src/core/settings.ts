import { z } from "zod";
import type { Db } from "../platform/types.js";
import { RolesSchema } from "../modules/wiki/layout.js";

/** Non-secret settings. Secrets never go here — they go to connections.secrets_enc. */
export const SettingsSchema = z.object({
  toolLanguage: z.enum(["en", "ko", "both"]).default("en"),
  timezone: z.string().default("UTC"),
  modules: z.record(z.string(), z.object({ enabled: z.boolean(), config: z.unknown().optional() })).default({}),
  /** Tool names hidden from Claude even if their module is on. Destructive tools are hidden unless listed in enabledDestructive. */
  disabledTools: z.array(z.string()).default([]),
  enabledDestructive: z.array(z.string()).default([]),
  vault: z
    .object({
      connection: z.string().optional(), // connections.name of kind "storage"
      readOnly: z.boolean().default(false),
      protectedPaths: z.array(z.string()).default(["CLAUDE.md", "AGENTS.md", "_templates/**", ".obsidian/**"]),
      maxWriteBytes: z.number().int().positive().default(512 * 1024),
    })
    .default({ readOnly: false, protectedPaths: ["CLAUDE.md", "AGENTS.md", "_templates/**", ".obsidian/**"], maxWriteBytes: 524288 }),
  mcp: z
    .object({
      /** CIDRs allowed to call /mcp. Empty = any. Preset: Anthropic outbound ranges. */
      allowCidrs: z.array(z.string()).default([]),
      enforceAllow: z.boolean().default(false),
    })
    .default({ allowCidrs: [], enforceAllow: false }),
  oauth: z
    .object({ allowedRedirectHosts: z.array(z.string()).default(["claude.ai", "claude.com"]) })
    .default({ allowedRedirectHosts: ["claude.ai", "claude.com"] }),
  wiki: z
    .object({
      preset: z.string().optional(),
      roles: RolesSchema.default({ index: { style: "none" }, rules: [] }),
      lint: z.record(z.string(), z.object({ enabled: z.boolean(), options: z.record(z.string(), z.unknown()).optional() })).default({}),
    })
    .default({ roles: { index: { style: "none" }, rules: [] }, lint: {} }),
  ledger: z
    .object({
      /** Place names (from your location provider's named areas) that mean "office": a transit-card tap there is an office gate, not a ride. */
      officePlaces: z.array(z.string()).default([]),
      paymentsNote: z.string().default("ledger/payments/{year}.md"),
      moneyNote: z.string().default("ledger/money.md"),
      language: z.enum(["ko", "en"]).default("en"),
      /** Days an unreadable message waits in the inbox before it is deleted. */
      inboxDays: z.number().int().min(1).max(365).default(30),
      /** Mail folders read for receipt mails (through recipes), e.g. { connection: "kakao", folder: "Payments" }. */
      mailSources: z.array(z.object({ connection: z.string().min(1).max(32), folder: z.string().min(1).max(200) })).max(10).default([]),
    })
    .default({ officePlaces: [], paymentsNote: "ledger/payments/{year}.md", moneyNote: "ledger/money.md", language: "en", inboxDays: 30, mailSources: [] }),
  location: z
    .object({
      connection: z.string().optional(), // connections.name of kind "location" (default: the first one)
      geocoder: z.string().optional(), // connections.name of kind "geocoder" (default: the first one)
      language: z.enum(["ko", "en"]).default("en"),
      /** Area names that are never written anywhere (e.g. "Home" if you don't want it in notes). */
      privateAreas: z.array(z.string().max(60)).max(20).default([]),
      stay: z.object({ radiusM: z.number().min(30).max(1000), minMinutes: z.number().min(3).max(240), mergeM: z.number().min(0).max(2000) }).default({ radiusM: 150, minMinutes: 15, mergeM: 200 }),
      /** Points sent to /ingest/owntracks are deleted after this many days. */
      keepDays: z.number().int().min(1).max(3650).default(400),
    })
    .default({ language: "en", privateAreas: [], stay: { radiusM: 150, minMinutes: 15, mergeM: 200 }, keepDays: 400 }),
  admin: z
    .object({ allowPublic: z.boolean().default(false) })
    .default({ allowPublic: false }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ANTHROPIC_OUTBOUND_CIDRS = ["160.79.104.0/21"];

export class SettingsStore {
  private cache?: Settings;
  constructor(private db: Db) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const rows = await this.db.all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
    const raw: Record<string, unknown> = {};
    for (const r of rows) raw[r.key] = JSON.parse(r.value);
    this.cache = SettingsSchema.parse(raw);
    return this.cache;
  }

  async set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    const full = SettingsSchema.parse({ ...(await this.get()), [key]: value });
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(full[key]), new Date().toISOString()],
    );
    this.cache = full;
  }
}

import { z } from "zod";
import type { Db } from "../platform/types.js";

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

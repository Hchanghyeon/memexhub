import type { z } from "zod";
import type { Platform } from "../platform/types.js";
import type { SafeVault } from "../storage/safe-vault.js";
import type { Settings } from "./settings.js";
import type { Text } from "./i18n.js";
import type { EventBus } from "./events.js";

/** An MCP tool contributed by a module. Descriptions are bilingual; settings.toolLanguage picks what Claude sees. */
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: Text;
  input: S;
  /** Hint for clients + used to hide destructive tools by default. */
  readOnly?: boolean;
  destructive?: boolean;
  run(args: z.infer<z.ZodObject<S>>, ctx: CallContext): Promise<string>;
}

export interface CallContext {
  actor: string; // "mcp:<client_id>"
}

/** A POST endpoint on the ingest surface. The token must carry `scope`. */
export interface IngestRoute {
  path: string; // "/ingest/message"
  scope: string; // "ledger"
  maxBytes: number;
  handle(body: unknown, ctx: { tokenId: string }): Promise<Record<string, unknown>>;
}

export interface ModuleContext {
  platform: Platform;
  settings: Settings;
  vault?: SafeVault;
  bus: EventBus;
  /** Instance of a connected provider of `kind` (named connection, or the first enabled one). */
  provider<T = unknown>(kind: string, name?: string): Promise<T | undefined>;
  /** Names of enabled connections of `kind` (several mail accounts …). */
  connections(kind: string): Promise<string[]>;
  /** Summary parts of all loaded modules (read when a tool runs, after every module is set up). */
  summaries(): { id: string; title: Text; summary: Summary }[];
}

/** One number a module reports for a week; the summary compares it with the week before. */
export interface WeekNumber {
  label: string;
  value: number;
  unit?: string; // "₩", "km", "min" …
  decimals?: number;
}
export interface WeekPart {
  lines: string[];
  numbers: WeekNumber[];
}
/** Composite: each module contributes its part of day_summary / week_summary. Dates are YYYY-MM-DD in the hub time zone. */
export interface Summary {
  day?(date: string): Promise<string[] | undefined>;
  week?(from: string, to: string): Promise<WeekPart | undefined>;
}

/** Periodic work, e.g. checking receipt mails. Runs in-process on Node, via cron on Workers. */
export interface JobDef {
  id: string;
  everyMinutes: number;
  run(): Promise<void>;
}

export interface ModuleInstance {
  tools?: ToolDef<any>[];
  ingest?: IngestRoute[];
  jobs?: JobDef[];
  status?(): Promise<{ ok: boolean; detail?: string }>;
  /** Actions for the admin UI only (never exposed to MCP). Typed by the module that provides it. */
  admin?: unknown;
  summary?: Summary;
}

/** Plugin contract. Adding a module = new folder + one line in src/modules/index.ts. */
export interface ModuleDef {
  id: string;
  title: Text;
  needs?: ("vault")[];
  setup(ctx: ModuleContext): ModuleInstance | Promise<ModuleInstance>;
}

export const defineModule = (m: ModuleDef) => m;
export const defineTool = <S extends z.ZodRawShape>(t: ToolDef<S>) => t;

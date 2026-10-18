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
  run(args: z.infer<z.ZodObject<S>>, ctx: CallContext): Promise<string | ToolResult>;
}

/** A tool answer with pictures (e.g. photo previews for Claude to look at). The text always comes first. */
export interface ToolResult {
  text: string;
  images: { data: string; mimeType: string }[]; // base64
}
export const textOf = (r: string | ToolResult) => (typeof r === "string" ? r : r.text);

export interface CallContext {
  actor: string; // "mcp:<client_id>"
}

/** A POST endpoint on the ingest surface. The token must carry `scope`. */
export interface IngestRoute {
  path: string; // "/ingest/message"
  scope: string; // "ledger"
  maxBytes: number;
  handle(body: unknown, ctx: { tokenId: string }): Promise<Record<string, unknown>>;
  /** Response body when the sender expects its own format (OwnTracks wants a JSON array). Default `{ ok: true, ...result }`. */
  reply?(result: Record<string, unknown>): unknown;
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
/**
 * One timed thing on a day, given to day_summary so it can merge records of the same moment into scenes
 * (a calendar dinner + a stay at the restaurant + its payment = one scene). Times are epoch milliseconds.
 */
export interface DayEvent {
  kind: "stay" | "pay" | "transit" | "office" | "event" | "meal" | "photo";
  start: number;
  end?: number;
  label: string;
  /** A registered place (home, office, a station …): an everyday place, not where an appointment happens. */
  named?: boolean;
  amount?: string;
  online?: boolean;
}
/** Composite: each module contributes its part of day_summary / week_summary. Dates are YYYY-MM-DD in the hub time zone. */
export interface Summary {
  day?(date: string): Promise<string[] | undefined>;
  /** The day's timed records, for merging into scenes. */
  events?(date: string): Promise<DayEvent[] | undefined>;
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

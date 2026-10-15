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
  path: string; // "/ingest/sms"
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

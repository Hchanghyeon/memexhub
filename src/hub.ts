import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Platform } from "./platform/types.js";
import type { Env } from "./core/config.js";
import { migrate } from "./core/migrations.js";
import { SettingsStore, type Settings } from "./core/settings.js";
import { Connections } from "./core/connections.js";
import { EventBus } from "./core/events.js";
import { pick } from "./core/i18n.js";
import type { IngestRoute, ModuleDef, ToolDef } from "./core/registry.js";
import { SafeVault } from "./storage/safe-vault.js";
import { Layout } from "./modules/wiki/layout.js";
import { StorageError } from "./storage/types.js";
import { buildStorage, type StorageBuilders } from "./storage/factory.js";
import { AdminAuth } from "./auth/admin.js";
import { OAuthServer } from "./auth/oauth.js";
import { IngestTokens } from "./auth/ingest-tokens.js";

/**
 * Composition root. Holds the long-lived services and (re)loads modules when settings change,
 * so turning a module on in the admin UI takes effect without a restart.
 */
export class Hub {
  settings: SettingsStore;
  connections: Connections;
  bus: EventBus;
  admin: AdminAuth;
  oauth: OAuthServer;
  ingestTokens: IngestTokens;
  vault?: SafeVault;
  tools: ToolDef<any>[] = [];
  ingest: IngestRoute[] = [];
  moduleStatus: { id: string; enabled: boolean; error?: string }[] = [];

  constructor(public platform: Platform, public env: Env, private modules: ModuleDef[], private storageBuilders: StorageBuilders) {
    const db = platform.db;
    this.settings = new SettingsStore(db);
    this.connections = new Connections(db, platform.secret);
    this.bus = new EventBus(db);
    this.admin = new AdminAuth(db, platform.secret);
    this.oauth = new OAuthServer(db, env.PUBLIC_URL, async () => (await this.settings.get()).oauth.allowedRedirectHosts);
    this.ingestTokens = new IngestTokens(db);
  }

  async init() {
    await migrate(this.platform.db);
    await this.reload();
    if (!(await this.admin.hasAdmin())) {
      const code = await this.admin.issueSetupCode();
      // The only place the setup code ever appears.
      console.log(`\n  memexhub is unclaimed. Open the admin UI and enter this one-time setup code:\n\n      ${code}\n`);
    }
  }

  /** Re-read settings, rebuild storage and modules. */
  async reload() {
    const s = await this.settings.get();
    this.vault = undefined;
    try {
      const store = await buildStorage(this.connections, s.vault.connection, this.storageBuilders);
      if (store) {
        const layout = new Layout(s.wiki.roles);
        this.vault = new SafeVault(
          store,
          { ...s.vault, protectedPaths: [...s.vault.protectedPaths, ...layout.protectedGlobs()], writeOncePaths: layout.writeOnceGlobs() },
          this.platform.db,
          "system",
        );
      }
    } catch (e) {
      this.platform.log.warn("vault storage unavailable", { error: (e as Error).message });
    }
    this.bus.reset();
    const tools: ToolDef<any>[] = [];
    const ingest: IngestRoute[] = [];
    this.moduleStatus = [];
    for (const m of this.modules) {
      const enabled = s.modules[m.id]?.enabled ?? ["vault", "wiki", "hub"].includes(m.id);
      if (!enabled) {
        this.moduleStatus.push({ id: m.id, enabled: false });
        continue;
      }
      if (m.needs?.includes("vault") && !this.vault) {
        this.moduleStatus.push({ id: m.id, enabled: true, error: "vault not connected" });
        continue;
      }
      try {
        const inst = await m.setup({ platform: this.platform, settings: s, vault: this.vault, bus: this.bus });
        tools.push(...(inst.tools ?? []));
        ingest.push(...(inst.ingest ?? []));
        this.moduleStatus.push({ id: m.id, enabled: true });
      } catch (e) {
        this.moduleStatus.push({ id: m.id, enabled: true, error: (e as Error).message });
      }
    }
    this.tools = tools;
    this.ingest = ingest;
  }

  /** Tools Claude may see: module on, not disabled, destructive only if explicitly enabled. */
  async visibleTools(): Promise<ToolDef<any>[]> {
    const s = await this.settings.get();
    return this.tools.filter((t) => !s.disabledTools.includes(t.name) && (!t.destructive || s.enabledDestructive.includes(t.name)));
  }

  /** Builder: a fresh stateless MCP server per request (works the same on Node and Workers). */
  async buildMcpServer(actor: string): Promise<McpServer> {
    const s: Settings = await this.settings.get();
    const server = new McpServer({ name: "memexhub", version: "0.1.0" });
    for (const t of await this.visibleTools()) {
      server.registerTool(
        t.name,
        {
          description: pick(t.description, s.toolLanguage),
          inputSchema: t.input,
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive },
        },
        async (args: any) => {
          try {
            const text = await t.run(z.object(t.input).parse(args), { actor });
            return { content: [{ type: "text" as const, text }] };
          } catch (e) {
            // Expected errors are shown to the model; unexpected ones are logged without details.
            const msg = e instanceof StorageError || e instanceof z.ZodError ? (e as Error).message : "internal error";
            if (!(e instanceof StorageError || e instanceof z.ZodError)) this.platform.log.error("tool failed", { tool: t.name });
            return { content: [{ type: "text" as const, text: `error: ${msg}` }], isError: true };
          }
        },
      );
    }
    return server;
  }
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Platform } from "./platform/types.js";
import type { Env } from "./core/config.js";
import { migrate } from "./core/migrations.js";
import { SettingsStore, type Settings } from "./core/settings.js";
import { Connections } from "./core/connections.js";
import { EventBus } from "./core/events.js";
import { pick } from "./core/i18n.js";
import type { IngestRoute, JobDef, ModuleDef, ToolDef } from "./core/registry.js";
import type { ProviderDef } from "./providers/types.js";
import { guardedFetch } from "./core/guarded-fetch.js";
import { GoogleSignIn } from "./auth/google-signin.js";
import { GOOGLE } from "./providers/tasks/google.js";
import { Cursors } from "./core/cursors.js";
import { SafeVault } from "./storage/safe-vault.js";
import { Layout } from "./modules/wiki/layout.js";
import { StorageError } from "./storage/types.js";
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
  google: GoogleSignIn;
  ingestTokens: IngestTokens;
  vault?: SafeVault;
  /** Byte access to the vault for the built-in WebDAV — only when enabled and the vault is held by this server. */
  davFiles?: import("./storage/files.js").RawFiles;
  tools: ToolDef<any>[] = [];
  ingest: IngestRoute[] = [];
  moduleStatus: { id: string; enabled: boolean; error?: string }[] = [];
  /** Admin-only module APIs (see ModuleInstance.admin). */
  moduleAdmin = new Map<string, unknown>();
  /** Summary parts by module, in module order (Composite for day_summary / week_summary). */
  summaries: { id: string; title: import("./core/i18n.js").Text; summary: import("./core/registry.js").Summary }[] = [];
  jobs: { module: string; job: JobDef }[] = [];
  private instances = new Map<string, Promise<unknown>>();

  constructor(public platform: Platform, public env: Env, private modules: ModuleDef[], public providers: ProviderDef[]) {
    const db = platform.db;
    this.settings = new SettingsStore(db);
    this.connections = new Connections(db, platform.secret);
    this.bus = new EventBus(db);
    this.admin = new AdminAuth(db, platform.secret);
    this.oauth = new OAuthServer(db, env.PUBLIC_URL, async () => (await this.settings.get()).oauth.allowedRedirectHosts);
    this.ingestTokens = new IngestTokens(db);
    // Only Google's token and userinfo hosts, https, no redirects.
    const gfetch = guardedFetch(platform.fetch, { hosts: GOOGLE.hosts, allowPrivate: false, isPrivate: platform.isPrivateHost?.bind(platform) });
    this.google = new GoogleSignIn(this.connections, new Cursors(db, () => platform.now()), env.PUBLIC_URL, gfetch, () => platform.now());
  }

  async init(opts: { setupCode?: string } = {}) {
    await migrate(this.platform.db);
    await this.reload();
    if (!(await this.admin.hasAdmin())) {
      if (opts.setupCode) return this.admin.useSetupCode(opts.setupCode);
      const code = await this.admin.issueSetupCode();
      // The only place the setup code ever appears.
      console.log(`\n  memexhub is unclaimed. Open the admin UI and enter this one-time setup code:\n\n      ${code}\n`);
    }
  }

  /** Re-read settings, rebuild storage and modules. */
  async reload() {
    this.settings.invalidate();
    const s = await this.settings.get();
    this.vault = undefined;
    this.davFiles = undefined;
    this.instances.clear();
    try {
      const store = await this.provider<import("./storage/types.js").VaultStorage>("storage", s.vault.connection);
      if (store) {
        const layout = new Layout(s.wiki.roles);
        if (s.dav.enabled && store.files) this.davFiles = store.files();
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
    const jobs: { module: string; job: JobDef }[] = [];
    this.moduleStatus = [];
    this.moduleAdmin.clear();
    const summaries: typeof this.summaries = [];
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
        const inst = await m.setup({
          platform: this.platform, settings: s, vault: this.vault, bus: this.bus,
          provider: (kind, name) => this.provider(kind, name) as any,
          connections: async (kind) => (await this.connections.list(kind)).filter((c) => c.enabled).map((c) => c.name),
          summaries: () => this.summaries,
        });
        tools.push(...(inst.tools ?? []));
        ingest.push(...(inst.ingest ?? []));
        jobs.push(...(inst.jobs ?? []).map((job) => ({ module: m.id, job })));
        if (inst.admin) this.moduleAdmin.set(m.id, inst.admin);
        if (inst.summary) summaries.push({ id: m.id, title: m.title, summary: inst.summary });
        this.moduleStatus.push({ id: m.id, enabled: true });
      } catch (e) {
        this.moduleStatus.push({ id: m.id, enabled: true, error: (e as Error).message });
      }
    }
    this.tools = tools;
    this.summaries = summaries;
    this.ingest = ingest;
    this.jobs = jobs;
  }

  /** Factory: connection row → provider instance (guarded fetch, decrypted secrets). Cached until the next reload. */
  async provider<T = unknown>(kind: string, name?: string): Promise<T | undefined> {
    const list = (await this.connections.list(kind)).filter((c) => c.enabled);
    const c = name ? list.find((x) => x.name === name) : list[0];
    if (!c) return undefined;
    const key = `${kind}:${c.name}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, (async () => {
        const def = this.providers.find((p) => p.kind === kind && p.id === c.provider);
        if (!def) throw new Error(`provider "${c.provider}" is not available`);
        if (!def.runtimes.includes(this.platform.name)) throw new Error(`provider "${c.provider}" does not run on ${this.platform.name}`);
        const config = def.config.parse(c.config);
        const secrets = def.secrets ? def.secrets.parse(await this.connections.secretsOf(c.id)) : {};
        const fetch = guardedFetch(this.platform.fetch, {
          hosts: def.hosts?.(config) ?? [],
          allowPrivate: def.allowPrivate?.(config) ?? false,
          isPrivate: this.platform.isPrivateHost?.bind(this.platform),
        });
        return def.create({ config, secrets, fetch, platform: this.platform, timezone: (await this.settings.get()).timezone, connection: { id: c.id, name: c.name } });
      })());
    }
    return (await this.instances.get(key)) as T;
  }

  /** Run module jobs that are due. Called every minute on Node; by cron on Workers. */
  async runDueJobs(now = this.platform.now()) {
    for (const { module, job } of this.jobs) {
      const key = `job:${module}:${job.id}`;
      const last = await this.platform.db.get<{ value: string }>(`SELECT value FROM cursors WHERE key = ?`, [key]);
      if (last && now.getTime() - Date.parse(last.value) < job.everyMinutes * 60_000) continue;
      await this.platform.db.run(
        `INSERT INTO cursors (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, now.toISOString(), now.toISOString()],
      );
      try {
        await job.run();
      } catch (e) {
        this.platform.log.warn("job failed", { job: key, error: (e as Error).message.slice(0, 120) });
      }
    }
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

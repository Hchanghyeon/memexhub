import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedFetch, BlockedRequest } from "../../src/core/guarded-fetch.js";
import { Hub } from "../../src/hub.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { defineModule } from "../../src/core/registry.js";
import { defineProvider } from "../../src/providers/types.js";
import { T } from "../../src/core/i18n.js";
import { fieldsOf, valuesOf } from "../../src/admin/forms.js";

const ok = (body = "hi", headers: Record<string, string> = {}, status = 200) => async () => new Response(body, { status, headers });

describe("guardedFetch (SSRF)", () => {
  const g = (base: any, extra: any = {}) => guardedFetch(base, { hosts: ["dav.example.com"], allowPrivate: false, isPrivate: async (h) => h === "dav.example.com" && extra.privateHost, ...extra });
  it("allows the configured https host", async () => {
    expect(await (await g(ok())("https://dav.example.com/x")).text()).toBe("hi");
  });
  it("blocks other hosts, http, credentials in URL, private targets and redirects", async () => {
    await expect(g(ok())("https://evil.example.net/")).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g(ok())("http://dav.example.com/")).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g(ok())("https://u:p@dav.example.com/")).rejects.toBeInstanceOf(BlockedRequest);
    await expect(g(ok(), { privateHost: true })("https://dav.example.com/")).rejects.toThrow(/private/);
    await expect(g(ok("", { location: "http://127.0.0.1/" }, 302))("https://dav.example.com/")).rejects.toThrow(/redirect/);
  });
  it("allows http to a private server only when the connection opts in", async () => {
    const f = guardedFetch(ok() as any, { hosts: ["nas.local"], allowPrivate: true, isPrivate: async () => true });
    expect((await f("http://nas.local/")).status).toBe(200);
  });
  it("caps response size even without content-length", async () => {
    const big = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000)); c.close(); } }));
    await expect(guardedFetch(big as any, { hosts: ["dav.example.com"], allowPrivate: false, maxBytes: 5000 })("https://dav.example.com/")).rejects.toThrow(/too large/);
  });
});

describe("provider factory and scheduler", () => {
  const mkHub = (providers: any[], modules: any[]) => {
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-p-")) });
    return new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {}, warn() {} } }, env, modules, providers);
  };
  const echo = defineProvider({
    kind: "echo", id: "e", title: T("e", "e"), runtimes: ["node"],
    config: z.object({ greeting: z.string() }), secrets: z.object({ key: z.string() }),
    create: ({ config, secrets }) => ({ say: () => `${config.greeting}:${secrets.key}` }),
  });
  it("builds instances with decrypted secrets and refuses wrong runtimes", async () => {
    const hub = mkHub([echo, { ...echo, id: "w", runtimes: ["workers"] }], []);
    const log = console.log; console.log = () => {}; await hub.init(); console.log = log;
    await hub.connections.upsert({ kind: "echo", provider: "e", name: "one", config: { greeting: "hi" }, secrets: { key: "s3cret" } }, "t");
    expect(((await hub.provider<any>("echo", "one")) as any).say()).toBe("hi:s3cret");
    await hub.connections.upsert({ kind: "echo", provider: "w", name: "two", config: { greeting: "x" } }, "t");
    await expect(hub.provider("echo", "two")).rejects.toThrow(/does not run/);
  });
  it("runs due jobs once per interval", async () => {
    let runs = 0;
    const m = defineModule({ id: "jobby", title: T("j", "j"), setup: () => ({ jobs: [{ id: "tick", everyMinutes: 30, run: async () => void runs++ }] }) });
    const hub = mkHub([], [m]);
    const log = console.log; console.log = () => {}; await hub.init(); console.log = log;
    await hub.settings.set("modules", { jobby: { enabled: true } });
    await hub.reload();
    const t0 = new Date("2026-10-15T00:00:00Z");
    await hub.runDueJobs(t0);
    await hub.runDueJobs(new Date(t0.getTime() + 10 * 60_000));
    await hub.runDueJobs(new Date(t0.getTime() + 31 * 60_000));
    expect(runs).toBe(2);
  });
});

describe("generated forms", () => {
  const schema = z.object({ url: z.string().url().describe("URL"), port: z.number().default(993), tls: z.boolean().default(true), mode: z.enum(["a", "b"]).optional() });
  it("reads fields and parses submitted values", () => {
    const f = fieldsOf(schema);
    expect(f.map((x) => `${x.key}:${x.type}`)).toEqual(["url:text", "port:number", "tls:checkbox", "mode:select"]);
    expect(f[0]!.label).toBe("URL");
    const v = valuesOf(f, { "config.url": "https://x.example.com", "config.port": "143", "config.mode": "" }, "config");
    expect(schema.parse(v)).toEqual({ url: "https://x.example.com", port: 143, tls: false });
    expect(fieldsOf(z.object({ password: z.string() }), true)[0]!.type).toBe("password");
  });
});

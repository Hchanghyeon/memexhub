import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { notionProvider, NotionClient, pageIdOf } from "../../src/providers/notion/client.js";
import { testFs } from "../helpers.js";

/** A fake Notion API: databases with one data source, pages, PATCH; one 429 on the first page create. */
const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
const pages = new Map<string, any>();
let throttled = false;
const fakeNotion = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method: init?.method ?? "GET", path: u.pathname, body, headers: init?.headers as Record<string, string> });
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
  if (u.host !== "api.notion.com") return new Response("blocked", { status: 599 });
  if (u.pathname === "/v1/databases") return json({ object: "database", id: `db-${calls.length}`, data_sources: [{ id: `ds-${calls.length}`, name: body.title[0].text.content }] });
  if (u.pathname === "/v1/pages" && init?.method === "POST") {
    if (!throttled) {
      throttled = true;
      return json({ code: "rate_limited" }, 429, { "retry-after": "0" });
    }
    const id = `page-${pages.size + 1}`;
    pages.set(id, body);
    return json({ id });
  }
  const m = u.pathname.match(/^\/v1\/pages\/(.+)$/);
  if (m && init?.method === "PATCH") return (pages.set(m[1]!, { ...pages.get(m[1]!), ...body }), json({ id: m[1] }));
  if (m) return json({ id: m[1] });
  return json({ code: "object_not_found" }, 404);
}) as typeof fetch;

let hub: Hub;
const sync = () => (hub.moduleAdmin.get("notion") as { sync(): Promise<any[]> }).sync();
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-no-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T03:00:00Z"), fetch: fakeNotion, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-nov-"))), notionProvider]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.connections.upsert({ kind: "notion", provider: "notion", name: "notion", config: { parentPage: "https://www.notion.so/Sample-Page-0123456789abcdef0123456789abcdef" }, secrets: { token: "secret_" + "x".repeat(30) } }, "t");
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("notion", { ledger: true, health: true });
  await hub.settings.set("modules", { ledger: { enabled: true }, health: { enabled: true }, notion: { enabled: true } });
  await hub.reload();
  const ingest = (p: string) => hub.ingest.find((r) => r.path === p)!;
  await ingest("/ingest/transaction").handle({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card", time: "2026-10-14T12:30:00+09:00" }, { tokenId: "t" });
  await ingest("/ingest/transaction").handle({ merchant: "Sample Books", amount: "₩9,900", card: "Card", time: "2026-10-14T15:00:00+09:00" }, { tokenId: "t" });
  await ingest("/ingest/health").handle({ date: "2026-10-14", steps: 8000 }, { tokenId: "t" });
});

describe("Notion output sink", () => {
  it("parses page links and ids", () => {
    expect(pageIdOf("https://www.notion.so/Sample-Page-0123456789abcdef0123456789abcdef")).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(pageIdOf("01234567-89ab-cdef-0123-456789abcdef")).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(pageIdOf("not a page")).toBeNull();
  });

  it("creates the databases once and one row per record, waiting out a 429", async () => {
    const r = await sync();
    expect(r).toEqual([{ kind: "ledger", created: 2, updated: 0, unchanged: 0, more: false }, { kind: "health", created: 1, updated: 0, unchanged: 0, more: false }]);
    const dbs = calls.filter((c) => c.path === "/v1/databases");
    expect(dbs.length).toBe(2);
    expect(dbs[0]!.body.parent).toEqual({ type: "page_id", page_id: "01234567-89ab-cdef-0123-456789abcdef" });
    expect(dbs[0]!.body.initial_data_source.properties.Merchant).toEqual({ title: {} });
    expect(calls[0]!.headers["notion-version"]).toBe("2025-09-03");
    const row = [...pages.values()].find((p) => p.properties?.Merchant?.title?.[0]?.text?.content === "Sample Cafe");
    expect(row.parent).toEqual({ type: "data_source_id", data_source_id: expect.stringMatching(/^ds-/) });
    expect(row.properties.Amount).toEqual({ number: 4500 });
    expect(row.properties.Date.date.start).toBe("2026-10-14T12:30:00+09:00");
  });

  it("re-syncing creates nothing; a changed record updates its own row", async () => {
    const before = calls.length;
    expect(await sync()).toEqual([{ kind: "ledger", created: 0, updated: 0, unchanged: 2, more: false }, { kind: "health", created: 0, updated: 0, unchanged: 1, more: false }]);
    expect(calls.filter((c, i) => i >= before && c.path === "/v1/databases").length).toBe(0);
    await hub.ingest.find((r) => r.path === "/ingest/health")!.handle({ date: "2026-10-14", steps: 9100 }, { tokenId: "t" });
    expect(await sync()).toEqual([{ kind: "ledger", created: 0, updated: 0, unchanged: 2, more: false }, { kind: "health", created: 0, updated: 1, unchanged: 0, more: false }]);
    const patch = calls.filter((c) => c.method === "PATCH").pop()!;
    expect(patch.body.properties.Steps).toEqual({ number: 9100 });
    expect(pages.size).toBe(3);
  });

  it("only the switched-on kinds, and only api.notion.com", async () => {
    await hub.settings.set("notion", { ledger: false, health: false });
    await hub.reload();
    expect(await sync()).toEqual([]);
    expect(hub.jobs.map((j) => j.job.id)).not.toContain("notion-sync");
    const n = new NotionClient({ token: "t", version: "2025-09-03", parentPage: "x" }, fakeNotion, async () => {});
    expect(() => n.parentPageId).toThrow(/not a Notion page/);
  });
});

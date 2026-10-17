import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { ingestApp } from "../../src/http/ingest.js";
import { PRESETS } from "../../src/modules/wiki/layout.js";
import { testFs } from "../helpers.js";

let hub: Hub, app: Hono, token = "", healthOnly = "";
const fetched: string[] = [];
const post = (body: unknown, tok = token) =>
  app.request("https://hub.example.com/ingest/share", { method: "POST", headers: { "x-ingest-token": tok, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-sh-")) });
  const spy = (async (u: RequestInfo | URL) => (fetched.push(String(u)), new Response("no"))) as typeof fetch;
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-17T11:05:00Z"), fetch: spy, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-shv-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("wiki", { ...s.wiki, preset: "llm-wiki", roles: PRESETS["llm-wiki"]! });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("toolLanguage", "ko");
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", ingestApp(hub));
  token = (await hub.ingestTokens.create("share sheet", ["share"], "t")).token;
  healthOnly = (await hub.ingestTokens.create("health", ["health"], "t")).token;
});

describe("share sheet ingest", () => {
  it("saves a shared link and note as a source, without opening the link", async () => {
    const r = await post({ text: "Look at this https://www.example.com/p/abc123", note: "read later about sourdough" });
    const j = (await r.json()) as { ok: boolean; saved: string };
    expect(j.ok).toBe(true);
    expect(j.saved).toBe("raw/2026-10-17 공유 - Look at this.md");
    const note = (await hub.vault!.read(j.saved)).text;
    expect(note).toContain("type: source");
    expect(note).toContain('source: "https://www.example.com/p/abc123"');
    expect(note).toContain("> 폰에서 공유함 (20:05)");
    expect(note).toContain("**내 메모**: read later about sourdough");
    expect(fetched).toEqual([]);
  });
  it("a link alone is named after its site; the same title twice gets a number", async () => {
    const a = (await (await post({ url: "https://example.com/watch?v=1" })).json()) as { saved: string };
    const b = (await (await post({ url: "https://example.com/watch?v=2" })).json()) as { saved: string };
    expect(a.saved).toBe("raw/2026-10-17 공유 - example.com.md");
    expect(b.saved).toBe("raw/2026-10-17 공유 - example.com (2).md");
  });
  it("needs the share scope and something to save", async () => {
    expect((await post({ url: "https://example.com" }, healthOnly)).status).toBe(401);
    expect((await post({ note: "only a note" })).status).toBe(422);
    expect((await post({ text: "x".repeat(30_000) })).status).toBe(422);
  });
});

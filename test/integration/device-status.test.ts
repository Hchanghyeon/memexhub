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
import { testFs } from "../helpers.js";

let hub: Hub, app: Hono, phone = "", healthOnly = "", revoked = "";
const NOW = new Date("2026-10-27T05:00:00Z");
const status = (tok: string) => app.request("https://hub.example.com/ingest/status", { headers: { "x-ingest-token": tok } });

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-ds-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => NOW, fetch: (async () => new Response("no")) as typeof fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-dsv-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "location", provider: "owntracks", name: "phone", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("location", { ...s.location, connection: "phone" });
  await hub.settings.set("modules", { ledger: { enabled: true }, location: { enabled: true } });
  await hub.reload();
  app = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", ingestApp(hub));
  phone = (await hub.ingestTokens.create("phone", ["ledger", "location"], "t")).token;
  healthOnly = (await hub.ingestTokens.create("watch", ["health"], "t")).token;
  const r = await hub.ingestTokens.create("old", ["ledger"], "t");
  revoked = r.token;
  await hub.ingestTokens.revoke(r.id, "t");
  const db = hub.platform.db;
  // Location stopped two days ago; one card text waits to be checked; the mail connection fails.
  await db.run(`INSERT INTO location_points (t, lat, lon, acc, device) VALUES (?, 37.5, 127.0, 10, 'x')`, [Math.floor(+NOW / 1000) - 50 * 3600]);
  await db.run(`INSERT INTO inbox (id, module, channel, received_at, reason, blob) VALUES ('i1', 'ledger', 'sms', '2026-10-27T04:30:00Z', 'unreadable', 'Sample Cafe 12,000원')`);
  await hub.connections.upsert({ kind: "mail", provider: "imap", name: "mail", config: {} }, "t");
  await db.run(`UPDATE connections SET status = 'error', last_error = 'imap.example.com login failed' WHERE name = 'mail'`);
});

describe("device status", () => {
  it("tells the phone what needs a look, for its own scopes", async () => {
    const r = await status(phone);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { stale: { source: string; hours: number }[]; inbox: { pending: number; newest: string }; connectionErrors: string[] };
    expect(j.stale).toEqual([expect.objectContaining({ source: "location", hours: 50 })]);
    expect(j.inbox).toEqual({ pending: 1, newest: "2026-10-27T04:30:00Z" });
    expect(j.connectionErrors).toEqual(["mail"]);
  });

  it("never returns content: no message text, coordinates or error details", async () => {
    const body = await (await status(phone)).text();
    for (const secret of ["Sample Cafe", "12,000", "37.5", "127", "imap.example.com"]) expect(body).not.toContain(secret);
  });

  it("leaves out what the token may not send", async () => {
    const j = (await (await status(healthOnly)).json()) as { stale: unknown[]; inbox?: unknown };
    expect(j.stale).toEqual([]);
    expect(j.inbox).toBeUndefined();
  });

  it("refuses missing, wrong and revoked tokens", async () => {
    expect((await status("")).status).toBe(401);
    expect((await status("x".repeat(64))).status).toBe(401);
    expect((await status(revoked)).status).toBe(401);
  });

  it("is not a record: checking does not count as the token's last use", async () => {
    await status(phone);
    const row = (await hub.ingestTokens.list()).find((t) => t.name === "phone");
    expect(row?.last_used_at).toBeNull();
  });

  it("is read-only: POST to it is not a route", async () => {
    const r = await app.request("https://hub.example.com/ingest/status", { method: "POST", headers: { "x-ingest-token": phone, "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(404);
  });
});

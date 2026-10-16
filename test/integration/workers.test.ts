import { describe, expect, it } from "vitest";
import worker from "../../src/worker.js";
import { totp } from "../../src/core/crypto.js";
import { fakeD1, fakeR2 } from "../helpers.js";

/** Runs the real Workers entry with a D1 on SQLite and an in-memory R2 bucket. */
const env = { MEMEXHUB_SECRET: "w".repeat(48), PUBLIC_URL: "https://memex.example.workers.dev", SETUP_CODE: "TEST-SETU-PCOD-E123", TZ: "UTC", DB: fakeD1(), VAULT: fakeR2() };
const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
let cookie = "", csrf = "";
const req = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.50");
  if (cookie) headers.set("cookie", cookie);
  return worker.fetch(new Request(`https://memex.example.workers.dev${path}`, { ...init, headers }), env as any, ctx);
};
const api = (path: string, body?: unknown) =>
  req(`/admin/api${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify(body) });
const ASSETS = { fetch: async (r: Request) => (new URL(r.url).pathname === "/index.html" ? new Response("<!doctype html><div id=root></div>") : new Response("missing", { status: 404 })) };
(env as any).ASSETS = ASSETS;

describe("Cloudflare Workers entry", () => {
  it("serves health, OAuth metadata and refuses MCP before setup", async () => {
    expect(await (await req("/healthz")).text()).toBe("ok");
    expect(((await (await req("/.well-known/oauth-authorization-server")).json()) as any).issuer).toBe("https://memex.example.workers.dev");
    expect((await req("/register", { method: "POST", body: "{}" })).status).toBe(503);
  });

  it("sets up with SETUP_CODE, forces two-factor first, then connects the R2 vault", async () => {
    expect((await api("/setup", { code: "wrong-code-0000", username: "owner", password: "a-long-test-password" })).status).toBe(403);
    const r = await api("/setup", { code: "test-setu-pcod-e123", username: "owner", password: "a-long-test-password" });
    expect(r.status).toBe(200);
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const s = (await (await api("/session")).json()) as any;
    expect(s).toMatchObject({ signedIn: true, mustEnrol: true, platform: "workers" });
    csrf = s.csrf;
    expect((await api("/overview")).status).toBe(403);
    const { secret } = (await (await api("/totp/start", {})).json()) as any;
    expect((await api("/totp/confirm", { code: await totp(secret, Date.now()) })).status).toBe(200);
    expect(((await (await api("/start")).json()) as any).runtime).toBe("workers");
    expect((await api("/vault", { provider: "r2" })).status).toBe(200);
    expect((await api("/wiki/preset", { preset: "llm-wiki" })).status).toBe(200);
    const page = await req("/admin/vault");
    expect(await page.text()).toContain("<div id=root>");
  });

  it("records a payment from a device into the R2 vault and runs jobs on the cron trigger", async () => {
    await api("/modules", { on: ["wiki", "ledger"] });
    const { token } = (await (await api("/devices", { name: "phone", scopes: ["ledger"] })).json()) as any;
    const r = await worker.fetch(
      new Request("https://memex.example.workers.dev/ingest/transaction", { method: "POST", headers: { "x-ingest-token": token, "content-type": "application/json", "cf-connecting-ip": "198.51.100.1" }, body: JSON.stringify({ merchant: "Sample Cafe", amount: "₩4,500", card: "Card", time: "2026-10-14T03:30:00Z" }) }),
      env as any,
      ctx,
    );
    expect(((await r.json()) as any).kind).toBe("payment");
    const note = await env.VAULT.get("ledger/payments/2026.md");
    expect(await note!.text()).toContain("Sample Cafe");
    let ran: Promise<unknown> | undefined;
    await worker.scheduled({}, env as any, { waitUntil: (p) => void (ran = p) });
    await ran;
    const rows = await env.DB.prepare("SELECT key FROM cursors WHERE key LIKE 'job:%'").all();
    expect((rows.results as { key: string }[]).map((r) => r.key)).toContain("job:hub:auth-cleanup");
  });
});

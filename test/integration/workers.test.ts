import { describe, expect, it } from "vitest";
import worker from "../../src/worker.js";
import { totp } from "../../src/core/crypto.js";
import { fakeD1, fakeR2 } from "../helpers.js";

/** Runs the real Workers entry with a D1 on SQLite and an in-memory R2 bucket. */
const env = { MEMEXHUB_SECRET: "w".repeat(48), PUBLIC_URL: "https://memex.example.workers.dev", SETUP_CODE: "TEST-SETU-PCOD-E123", TZ: "UTC", DB: fakeD1(), VAULT: fakeR2() };
const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
let cookie = "";
const req = (path: string, init: RequestInit & { form?: Record<string, string> } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", "203.0.113.50");
  if (cookie) headers.set("cookie", cookie);
  let body = init.body;
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }
  return worker.fetch(new Request(`https://memex.example.workers.dev${path}`, { ...init, headers, body }), env as any, ctx);
};
const csrfOf = async (path: string) => (await (await req(path)).text()).match(/name="csrf" value="([^"]+)"/)![1]!;

describe("Cloudflare Workers entry", () => {
  it("serves health, OAuth metadata and refuses MCP before setup", async () => {
    expect(await (await req("/healthz")).text()).toBe("ok");
    expect(((await (await req("/.well-known/oauth-authorization-server")).json()) as any).issuer).toBe("https://memex.example.workers.dev");
    expect((await req("/register", { method: "POST", body: "{}" })).status).toBe(503);
  });

  it("sets up with SETUP_CODE, forces two-factor first, then connects the R2 vault", async () => {
    expect((await req("/admin/setup", { method: "POST", form: { code: "wrong-code-0000", username: "owner", password: "a-long-test-password" } })).status).toBe(403);
    const r = await req("/admin/setup", { method: "POST", form: { code: "test-setu-pcod-e123", username: "owner", password: "a-long-test-password" } });
    expect(r.headers.get("location")).toBe("/admin/start");
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    expect((await req("/admin/start")).headers.get("location")).toBe("/admin/two-factor");
    const csrf = await csrfOf("/admin/two-factor");
    const key = (await (await req("/admin/totp", { method: "POST", form: { csrf } })).text()).match(/<pre>([A-Z2-7]+)<\/pre>/)![1]!;
    expect((await req("/admin/totp/confirm", { method: "POST", form: { csrf, code: await totp(key, Date.now()) } })).status).toBe(302);
    const vaultPage = await (await req("/admin/start?step=2")).text();
    expect(vaultPage).toContain('value="r2"');
    expect(vaultPage).not.toContain('value="builtin"');
    expect((await req("/admin/vault", { method: "POST", form: { csrf, provider: "r2", next: "3" } })).headers.get("location")).toBe("/admin/start?step=3");
    expect((await req("/admin/wiki/preset", { method: "POST", form: { csrf, preset: "llm-wiki", next: "4" } })).status).toBe(302);
  });

  it("records a payment from a device into the R2 vault and runs jobs on the cron trigger", async () => {
    const csrf = await csrfOf("/admin/features");
    const on = new URLSearchParams({ csrf });
    for (const m of ["wiki", "ledger"]) on.append("on", m);
    await req("/admin/modules", { method: "POST", body: on.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    const loc = (await req("/admin/tokens", { method: "POST", form: { csrf, name: "phone", scopes: "ledger" } })).headers.get("location")!;
    const token = new URL(loc, "https://x").searchParams.get("new_token")!;
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

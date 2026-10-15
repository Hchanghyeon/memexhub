import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { googleTasksProvider } from "../../src/providers/tasks/google.js";
import { mcpApp } from "../../src/http/mcp.js";
import { pkceS256 } from "../../src/core/crypto.js";

/** A fake Google: token endpoint (code + refresh), userinfo and a tiny Tasks API. */
const calls: string[] = [];
let tokenReq: URLSearchParams | undefined;
let issued = 0;
const tasks: Record<string, any[]> = { L1: [{ id: "t1", title: "Buy milk", status: "needsAction", due: "2026-10-20T00:00:00.000Z" }] };
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  calls.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}`);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (u.href === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init!.body));
    if (p.get("grant_type") === "authorization_code") {
      tokenReq = p;
      return p.get("code") === "good" ? json({ access_token: "at-0", refresh_token: "rt-secret", expires_in: 3600 }) : json({ error: "invalid_grant" }, 400);
    }
    return p.get("refresh_token") === "rt-secret" ? json({ access_token: `at-${++issued}`, expires_in: 3600 }) : json({ error: "invalid_grant" }, 400);
  }
  if (u.href === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: "someone@example.com" });
  if (u.host === "tasks.googleapis.com") {
    const auth = (init?.headers as Record<string, string>).authorization;
    if (auth === "Bearer at-1" && !calls.includes("expired-once")) {
      calls.push("expired-once");
      return json({ error: "expired" }, 401);
    }
    if (u.pathname === "/tasks/v1/users/@me/lists") return json({ items: [{ id: "L1", title: "Personal" }] });
    const m = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (m) {
      const list = (tasks[decodeURIComponent(m[1]!) === "@default" ? "L1" : decodeURIComponent(m[1]!)] ??= []);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method === "POST") {
        const t = { id: `t${list.length + 1}`, status: "needsAction", ...body };
        list.push(t);
        return json(t);
      }
      if (init?.method === "PATCH") return json(Object.assign(list.find((t) => t.id === m[2])!, body));
      if (init?.method === "DELETE") return new Response("", { status: 204 });
      return json({ items: list });
    }
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

let hub: Hub, mcp: Hono, conId = "";
const tool = (n: string) => hub.tools.find((t) => t.name === n)!;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-gt-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch: fakeFetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [googleTasksProvider]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  conId = await hub.connections.upsert({ kind: "tasks", provider: "google", name: "personal", config: { clientId: "client-123.apps.example" }, secrets: { clientSecret: "cs" } }, "t");
  await hub.settings.set("modules", { tasks: { enabled: true } });
  await hub.reload();
  mcp = new Hono().use("*", (c: any, n: any) => (c.set("ip", "198.51.100.1"), n())).route("/", mcpApp(hub));
});

describe("Google sign-in", () => {
  let state = "";
  it("starts with PKCE, minimal scopes and a one-time state", async () => {
    const url = new URL(await hub.google.start(conId));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.example.com/oauth/google/callback");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/tasks");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    state = url.searchParams.get("state")!;
    await expect(hub.google.start("nope")).rejects.toThrow(/not a Google connection/);
  });

  it("refuses a bad code and a reused state; stores the refresh token encrypted", async () => {
    const bad = await mcp.request(`https://hub.example.com/oauth/google/callback?state=${state}&code=bad`);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Google refused the sign-in");
    expect((await mcp.request(`https://hub.example.com/oauth/google/callback?state=${state}&code=good`)).status).toBe(400); // state is one-time
    const url = new URL(await hub.google.start(conId));
    const s2 = url.searchParams.get("state")!;
    const ok = await mcp.request(`https://hub.example.com/oauth/google/callback?state=${s2}&code=good`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("someone@example.com");
    expect(await pkceS256(tokenReq!.get("code_verifier")!)).toBe(url.searchParams.get("code_challenge"));
    expect((await hub.connections.secretsOf(conId)).refreshToken).toBe("rt-secret");
    const raw = await hub.platform.db.all<any>(`SELECT config, secrets_enc FROM connections`);
    expect(JSON.stringify(raw)).not.toContain("rt-secret");
    expect(JSON.parse(raw[0].config).email).toBe("someone@example.com");
    expect((await mcp.request("https://hub.example.com/oauth/google/callback?state=forged&code=good")).status).toBe(400);
    expect((await mcp.request("https://hub.example.com/oauth/google/callback?error=access_denied")).status).toBe(400);
  });
});

describe("task tools", () => {
  it("lists, adds, updates, completes; refreshes an expired token once", async () => {
    expect(await tool("tasks_accounts").run({}, { actor: "t" })).toBe("- personal");
    expect(await tool("tasklists").run({ account: "personal" }, { actor: "t" })).toBe("[personal] - Personal  [id L1]");
    const list = await tool("tasks_list").run({ account: "personal", tasklist: "Personal", show_completed: false, limit: 100 }, { actor: "t" });
    expect(list).toContain("⬜ Buy milk · due 2026-10-20  [id t1]");
    expect(calls).toContain("expired-once"); // 401 → new token → retried
    expect(await tool("task_add").run({ account: "personal", title: " Call the bank ", due: "2026-10-21", tasklist: "" }, { actor: "t" })).toContain("⬜ Call the bank · due 2026-10-21");
    expect(await tool("task_update").run({ account: "personal", task_id: "t2", due: "none", tasklist: "" }, { actor: "t" })).toContain("updated");
    expect(await tool("task_complete").run({ account: "personal", task_id: "t1", tasklist: "", undo: false }, { actor: "t" })).toContain("✅ Buy milk");
    expect(await tool("tasks_list").run({ account: "work", tasklist: "", show_completed: false, limit: 10 }, { actor: "t" })).toMatch(/no tasks account named "work"/);
    expect(await tool("tasks_list").run({ account: "personal", tasklist: "Nope", show_completed: false, limit: 10 }, { actor: "t" })).toMatch(/no task list "Nope"/);
  });
  it("task_delete is hidden until enabled", async () => {
    expect((await hub.visibleTools()).map((t) => t.name)).not.toContain("task_delete");
    expect((await hub.visibleTools()).map((t) => t.name)).toContain("task_add");
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HomeAssistant, homeAssistantProvider } from "../../src/providers/home/home-assistant.js";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";

const seen: URL[] = [];
const ha = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  seen.push(u);
  if (new Headers(init?.headers).get("authorization") !== `Bearer ${"t".padEnd(20, "x")}`) return new Response("", { status: 401 });
  const json = (b: unknown) => new Response(JSON.stringify(b));
  if (u.pathname === "/api/") return json({ message: "API running." });
  if (u.pathname === "/api/states") return json([{ entity_id: "light.desk", state: "on", last_changed: "2026-10-16T10:00:00+00:00", attributes: { friendly_name: "Desk lamp" } }, { entity_id: "sensor.temp", state: "22.5", attributes: {} }]);
  if (u.pathname.startsWith("/api/logbook/")) {
    const e = u.searchParams.get("entity");
    return json([
      { when: "2026-10-16T10:12:00+00:00", name: "Front door", message: "opened", entity_id: "binary_sensor.front_door" },
      { when: "2026-10-16T09:00:00+00:00", name: "Me", state: "home", entity_id: "person.me" },
    ].filter((x) => !e || x.entity_id === e));
  }
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;

describe("Home Assistant", () => {
  it("reads states and the logbook with the token, never calling services", async () => {
    const h = new HomeAssistant({ url: "http://ha.local:8123/", token: "t".padEnd(20, "x"), entities: [] }, ha);
    await h.ping();
    expect((await h.states())[0]).toEqual({ entity: "light.desk", name: "Desk lamp", state: "on", changed: "2026-10-16T10:00:00+00:00" });
    const log = await h.logbook(new Date("2026-10-16T00:00:00Z"), new Date("2026-10-17T00:00:00Z"), "person.me");
    expect(log).toEqual([{ when: "2026-10-16T09:00:00+00:00", entity: "person.me", name: "Me", message: "→ home" }]);
    expect(seen.at(-1)!.pathname).toBe("/api/logbook/2026-10-16T00:00:00.000Z");
    expect(seen.every((u) => !u.pathname.startsWith("/api/services"))).toBe(true);
    await expect(new HomeAssistant({ url: "http://ha.local:8123", token: "wrong-token-wrong-token", entities: [] }, ha).ping()).rejects.toThrow(/refused the token/);
  });

  it("puts the chosen entities in day_summary and offers home_states / home_day", async () => {
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-ha-")) });
    const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T12:00:00Z"), fetch: ha, log: { ...jsonLogger, info() {} }, isPrivateHost: async () => true } as any, env, MODULES, [homeAssistantProvider]);
    const log = console.log;
    console.log = () => {};
    await hub.init();
    console.log = log;
    await hub.settings.set("timezone", "Asia/Seoul");
    await hub.connections.upsert({ kind: "home", provider: "home-assistant", name: "house", config: { url: "http://ha.local:8123", entities: "person.me, binary_sensor.front_door", allowPrivateNetwork: true }, secrets: { token: "t".padEnd(20, "x") } }, "t");
    await hub.settings.set("modules", { home: { enabled: true } });
    await hub.reload();
    const tool = (n: string) => hub.tools.find((t) => t.name === n)!;
    expect(await tool("day_summary").run({ date: "2026-10-16" }, { actor: "t" })).toContain("18:00 Me → home");
    expect(await tool("home_states").run({ filter: "desk", limit: 60 }, { actor: "t" })).toBe("house: 1 entities\n- Desk lamp [light.desk]: on · since 2026-10-16 19:00");
    expect(await tool("home_day").run({ date: "2026-10-16" }, { actor: "t" })).toBe("house · 2026-10-16: 2 entries\n- 19:12 Front door opened\n- 18:00 Me → home");
  });
});

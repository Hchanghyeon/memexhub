import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { PORTABLE_PROVIDERS } from "../../src/providers/registry.js";
import { adminClient } from "../admin-client.js";

/** Outbound calls answered locally; anything unexpected fails the test. */
const fake = (async (u: string | URL) => {
  const url = new URL(String(u));
  if (["api.open-meteo.com", "archive-api.open-meteo.com"].includes(url.hostname)) {
    const d = url.searchParams.get("start_date")!;
    return new Response(JSON.stringify({ daily: { time: [d], weather_code: [3], temperature_2m_max: [18], temperature_2m_min: [9], precipitation_sum: [0] } }));
  }
  throw new Error(`unexpected request to ${url.hostname}`);
}) as unknown as typeof fetch;

let hub: Hub, a: ReturnType<typeof adminClient>;
beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-cn-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T03:00:00Z"), fetch: fake, log: { ...jsonLogger, info() {} } }, env, MODULES, PORTABLE_PROVIDERS);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  a = adminClient(hub);
  await a.login();
});

describe("adding a connection from the admin API", () => {
  it("tests it, switches on the matching feature, and Claude gets its tools and summary", async () => {
    expect(hub.tools.map((t) => t.name)).not.toContain("weather_days");
    const r = await (await a.post("/connections", { provider: "weather:open-meteo", name: "home", config: { place: "Sample City", latitude: "37.5", longitude: "127.0" }, secrets: {} })).json();
    expect(r.test).toEqual({ ok: true });
    expect((await hub.settings.get()).modules.weather?.enabled).toBe(true);
    const tool = hub.tools.find((t) => t.name === "weather_days")!;
    expect(await tool.run({ date: "2026-10-16", days: 1 }, { actor: "t" })).toBe("Sample City:\n- 2026-10-16 overcast · high 18° low 9°");
    const day = hub.tools.find((t) => t.name === "day_summary")!;
    expect(await day.run({ date: "2026-10-16" }, { actor: "t" })).toContain("Sample City: overcast · high 18° low 9°");
  });
});

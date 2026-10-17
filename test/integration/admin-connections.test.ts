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
const fake = (async (u: string | URL, init?: RequestInit) => {
  const url = new URL(String(u));
  if (["api.open-meteo.com", "archive-api.open-meteo.com"].includes(url.hostname)) {
    const d = url.searchParams.get("start_date")!;
    return new Response(JSON.stringify({ daily: { time: [d], weather_code: [3], temperature_2m_max: [18], temperature_2m_min: [9], precipitation_sum: [0] } }));
  }
  if (url.hostname === "dav.example.com") {
    const body = String(init?.body ?? "");
    const ms = (x: string) => new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${x}</d:multistatus>`, { status: 207 });
    if (body.includes("current-user-principal") || body.includes("calendar-home-set")) return ms("");
    if (init?.method === "PROPFIND") return ms(`<d:response><d:href>/cal/home/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname></d:prop></d:propstat></d:response>`);
    return ms(`<d:response><d:href>/cal/home/a.ics</d:href><d:propstat><d:prop><c:calendar-data>BEGIN:VEVENT\nDTSTART;TZID=Asia/Seoul:20261016T190000\nDTEND;TZID=Asia/Seoul:20261016T210000\nSUMMARY:Dinner\nEND:VEVENT</c:calendar-data></d:prop></d:propstat></d:response>`);
  }
  if (url.hostname === "ha.example.com") {
    if (url.pathname === "/api/") return new Response(JSON.stringify({ message: "API running." }));
    if (url.pathname === "/api/states") return new Response(JSON.stringify([
      { entity_id: "person.me", state: "home", attributes: { friendly_name: "Me" } },
      { entity_id: "binary_sensor.front_door", state: "off", attributes: { friendly_name: "Front door" } },
    ]));
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
  await hub.settings.set("timezone", "Asia/Seoul");
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

  it("a CalDAV calendar lands in day_summary and calendar_events", async () => {
    const r = await (await a.post("/connections", { provider: "calendar:caldav", name: "family", config: { url: "https://dav.example.com/cal/", username: "u" }, secrets: { password: "p" } })).json();
    expect(r.test).toEqual({ ok: true });
    expect((await hub.settings.get()).modules.calendar?.enabled).toBe(true);
    expect(await hub.tools.find((t) => t.name === "calendar_events")!.run({ date: "2026-10-16", days: 1 }, { actor: "t" })).toBe("2026-10-16\n- 19:00–21:00 Dinner (Home)");
    expect(await hub.tools.find((t) => t.name === "day_summary")!.run({ date: "2026-10-16" }, { actor: "t" })).toContain("19:00–21:00 Dinner (Home)");
  });

  it("edits a saved connection without showing or losing its secret, and deletes it", async () => {
    const add = await (await a.post("/connections", { provider: "calendar:caldav", name: "edit-me", config: { url: "https://dav.example.com/wrong", username: "me" }, secrets: { password: "old-secret-value" } })).json();
    const got = await a.json(`/connections/${add.id}`);
    expect(got).toMatchObject({ provider: "calendar:caldav", name: "edit-me", config: { url: "https://dav.example.com/wrong", username: "me" } });
    expect(JSON.stringify(got)).not.toContain("old-secret-value");
    await a.post("/connections", { provider: "calendar:caldav", name: "edit-me", config: { url: "https://dav.example.com/right", username: "me" }, secrets: { password: "" } });
    const con = await hub.connections.byId(add.id);
    expect(con?.config.url).toBe("https://dav.example.com/right");
    expect((await hub.connections.secretsOf(add.id)).password).toBe("old-secret-value");
    expect((await a.post(`/connections/${add.id}/remove`, {})).status).toBe(200);
    expect(await hub.connections.byId(add.id)).toBeUndefined();
    expect((await a.post(`/connections/${add.id}/remove`, {})).status).toBe(404);
  });

  it("offers Home Assistant entities to pick for the daily summary, once the connection is saved", async () => {
    const form = await a.json("/connections/form?provider=home:home-assistant");
    expect(form.choices).toEqual(["entities"]);
    const add = await (await a.post("/connections", { provider: "home:home-assistant", name: "house", config: { url: "https://ha.example.com" }, secrets: { token: "t".repeat(40) } })).json();
    expect(add.test).toEqual({ ok: true });
    const r = await a.json(`/connections/${add.id}/choices/entities`);
    expect(r.choices).toEqual([
      { value: "person.me", label: "Me", group: "person", note: "home" },
      { value: "binary_sensor.front_door", label: "Front door", group: "binary_sensor", note: "off" },
    ]);
    expect((await a.get(`/connections/${add.id}/choices/nope`)).status).toBe(404);
  });
});

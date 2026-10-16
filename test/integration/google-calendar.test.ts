import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { GoogleCalendar, googleCalendarProvider } from "../../src/providers/calendar/google.js";

const urls: URL[] = [];
const google = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  urls.push(u);
  const json = (b: unknown) => new Response(JSON.stringify(b));
  if (u.href === "https://oauth2.googleapis.com/token") return json({ access_token: "at", expires_in: 3600 });
  if (u.pathname.endsWith("/users/me/calendarList"))
    return json({ items: [{ id: "me@example.com", summary: "me@example.com", summaryOverride: "Personal" }, { id: "holidays#x", summary: "Holidays", hidden: true }, { id: "work@group", summary: "Work" }] });
  if (u.pathname.startsWith("/calendar/v3/calendars/work%40group/events") || u.pathname.startsWith("/calendar/v3/calendars/work@group/events"))
    return json({ items: [{ status: "confirmed", summary: "Standup", start: { dateTime: "2026-10-16T09:30:00+09:00" }, end: { dateTime: "2026-10-16T09:45:00+09:00" }, location: "Zoom" }, { status: "cancelled", summary: "Old" }] });
  if (u.pathname.includes("/events")) return json({ items: [{ summary: "Holiday trip", start: { date: "2026-10-16" }, end: { date: "2026-10-18" } }] });
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

describe("Google Calendar", () => {
  it("lists visible calendars and reads expanded events in the hub time zone", async () => {
    const g = new GoogleCalendar({ clientId: "c", clientSecret: "s", refreshToken: "rt", only: [], timezone: "Asia/Seoul" }, google);
    expect(await g.calendars()).toEqual([{ id: "me@example.com", name: "Personal" }, { id: "work@group", name: "Work" }]);
    const ev = await g.events("2026-10-16", "2026-10-16");
    expect(ev).toEqual([
      { calendar: "Personal", title: "Holiday trip", start: "2026-10-16", end: "2026-10-18", allDay: true },
      { calendar: "Work", title: "Standup", start: "2026-10-16T00:30:00.000Z", end: "2026-10-16T00:45:00.000Z", allDay: false, location: "Zoom" },
    ]);
    const q = urls.find((u) => u.pathname.includes("/events"))!.searchParams;
    expect([q.get("timeMin"), q.get("timeMax"), q.get("singleEvents")]).toEqual(["2026-10-15T15:00:00.000Z", "2026-10-16T15:00:00.000Z", "true"]);
    const only = new GoogleCalendar({ clientId: "c", clientSecret: "s", refreshToken: "rt", only: ["work"], timezone: "UTC" }, google);
    expect((await only.calendars()).map((c) => c.name)).toEqual(["Work"]);
  });

  it("asks Google only for read-only calendar access", async () => {
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-gc-")) });
    const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch: google, log: { ...jsonLogger, info() {} } }, env, MODULES, [googleCalendarProvider]);
    const log = console.log;
    console.log = () => {};
    await hub.init();
    console.log = log;
    const id = await hub.connections.upsert({ kind: "calendar", provider: "google", name: "g", config: { clientId: "client-123.apps.example" }, secrets: { clientSecret: "cs" } }, "t");
    const url = new URL(await hub.google.start(id));
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.readonly");
  });
});

describe("several Google accounts", () => {
  it("copies the app to another account, signs in separately, and labels events by account", async () => {
    const { adminClient } = await import("../admin-client.js");
    const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-gm-")) });
    const hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T03:00:00Z"), fetch: google, log: { ...jsonLogger, info() {} } }, env, MODULES, [googleCalendarProvider, (await import("../../src/providers/tasks/google.js")).googleTasksProvider]);
    const log = console.log;
    console.log = () => {};
    await hub.init();
    console.log = log;
    await hub.admin.createAdmin("owner", "a-long-test-password", "t");
    await hub.settings.set("timezone", "Asia/Seoul");
    const a = adminClient(hub);
    await a.login();
    const first = await hub.connections.upsert({ kind: "calendar", provider: "google", name: "personal", config: { clientId: "client-123.apps.example", email: "me@example.com" }, secrets: { clientSecret: "cs", refreshToken: "rt-personal" } }, "t");
    await hub.settings.set("modules", { calendar: { enabled: true } });
    await hub.reload();

    // another account: same app, no refresh token, no e-mail, straight to Google
    const r = await (await a.post(`/connections/${first}/another`, { name: "work" })).json();
    expect(new URL(r.url).searchParams.get("scope")).toContain("calendar.readonly");
    const work = (await hub.connections.byId(r.id))!;
    expect(work.config).toEqual({ clientId: "client-123.apps.example" });
    expect(await hub.connections.secretsOf(r.id)).toEqual({ clientSecret: "cs" });
    expect((await (await a.post(`/connections/${first}/another`, { name: "work" })).json()).error).toBe("invalid_input");

    // a new Google Tasks connection can reuse the same app
    const form = await a.json("/connections/form?provider=tasks:google");
    expect(form.reuse.map((x: { name: string }) => x.name)).toEqual(["personal", "work"]);
    const t = await (await a.post("/connections", { provider: "tasks:google", name: "todo", config: {}, secrets: {}, copyFrom: first })).json();
    expect(await hub.connections.secretsOf(t.id)).toEqual({ clientSecret: "cs" });
    expect((await (await a.post("/connections", { provider: "tasks:google", name: "x", config: {}, secrets: {}, copyFrom: "con_nope" })).json()).error).toBe("invalid_input");

    // both accounts signed in → each line says which account
    await hub.connections.patch(r.id, { secrets: { refreshToken: "rt-work" } }, "t");
    await hub.reload();
    const out = await hub.tools.find((x) => x.name === "calendar_events")!.run({ date: "2026-10-16", days: 1 }, { actor: "t" });
    expect(out).toContain("(Work · personal)");
    expect(out).toContain("(Work · work)");
  });
});

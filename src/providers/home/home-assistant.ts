import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import type { EntityState, HomeProvider, LogEntry } from "./types.js";

/** Home Assistant REST API with a long-lived access token. Read-only: states and logbook, never services. */
export class HomeAssistant implements HomeProvider {
  constructor(
    private o: { url: string; token: string; entities: string[] },
    private f: typeof fetch,
  ) {}

  get summaryEntities() {
    return this.o.entities;
  }

  private async get(path: string, params: Record<string, string> = {}) {
    const u = new URL(`${this.o.url.replace(/\/+$/, "")}${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await this.f(u, { headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" } });
    if (r.status === 401 || r.status === 403) throw new Error("Home Assistant refused the token: create a long-lived access token in your HA profile");
    if (!r.ok) throw new Error(`Home Assistant ${r.status}`);
    return r.json() as Promise<any>;
  }

  async ping() {
    const j = await this.get("/api/");
    if (!String(j?.message ?? "").includes("API running")) throw new Error("this address does not look like Home Assistant");
  }

  async states(): Promise<EntityState[]> {
    return ((await this.get("/api/states")) as any[]).map((s) => ({
      entity: String(s.entity_id),
      name: String(s.attributes?.friendly_name ?? s.entity_id),
      state: String(s.state),
      changed: String(s.last_changed ?? ""),
    }));
  }

  async logbook(from: Date, to: Date, entity?: string): Promise<LogEntry[]> {
    const rows = (await this.get(`/api/logbook/${from.toISOString()}`, { end_time: to.toISOString(), ...(entity ? { entity } : {}) })) as any[];
    return rows.map((e) => ({
      when: String(e.when),
      ...(e.entity_id ? { entity: String(e.entity_id) } : {}),
      name: String(e.name ?? e.entity_id ?? ""),
      message: String(e.message ?? (e.state !== undefined ? `→ ${e.state}` : "")),
    }));
  }
}

export const homeAssistantProvider = defineProvider({
  kind: "home",
  id: "home-assistant",
  title: T("Home Assistant", "홈 어시스턴트"),
  config: z.object({
    url: z.string().url().describe("Home Assistant address (e.g. http://192.168.0.10:8123)"),
    entities: z.string().max(1000).optional().describe("Entities for the daily summary, comma separated (e.g. person.me, binary_sensor.front_door)"),
    allowPrivateNetwork: z.boolean().default(true).describe("Home Assistant is on my home network"),
  }),
  secrets: z.object({ token: z.string().min(20).describe("Long-lived access token (HA → your profile → Security)") }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new HomeAssistant({ url: config.url, token: secrets.token, entities: String(config.entities ?? "").split(",").map((x) => x.trim()).filter(Boolean) }, fetch),
  test: async (h) => {
    await (h as HomeAssistant).ping();
  },
});

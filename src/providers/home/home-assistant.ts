import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";
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
    url: z.string().url().meta(F("Home Assistant address", "홈 어시스턴트 주소", ["The address you open Home Assistant with, e.g. http://192.168.0.10:8123. On the same home network, the home address is fastest.", "홈 어시스턴트를 여는 주소예요. 예: http://192.168.0.10:8123. 같은 집 네트워크에 있으면 집 안 주소가 가장 빨라요."])),
    entities: z.string().max(1000).optional().meta(F("Entities for the daily summary (optional)", "하루 요약에 넣을 엔티티 (선택)", ["Comma separated, e.g. person.me, binary_sensor.front_door. Their logbook goes into day_summary and the journal. Empty: only asked when you ask Claude.", "쉼표로 구분해요. 예: person.me, binary_sensor.front_door. 이 엔티티의 기록이 하루 요약과 일지에 들어가요. 비우면 Claude에게 물어볼 때만 봐요."])),
    allowPrivateNetwork: z.boolean().default(true).meta(F("Home Assistant is on my home network", "홈 어시스턴트가 집 네트워크 안에 있어요", ["Tick when the address starts with http:// or is a home address (192.168.x.x). Without it, only https internet addresses are allowed.", "주소가 http:// 로 시작하거나 192.168.x.x 같은 집 안 주소면 체크하세요. 끄면 https 인터넷 주소만 쓸 수 있어요."])),
  }),
  secrets: z.object({ token: z.string().min(20).meta(F("Long-lived access token", "장기 액세스 토큰", ["Home Assistant → your profile (bottom left) → Security → Long-lived access tokens → Create token. Read only: memexhub never switches anything.", "홈 어시스턴트 → 왼쪽 아래 내 프로필 → 보안 → 장기 액세스 토큰 → 토큰 만들기. memexhub는 읽기만 하고 아무것도 켜고 끄지 않아요."])) }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new HomeAssistant({ url: config.url, token: secrets.token, entities: String(config.entities ?? "").split(",").map((x) => x.trim()).filter(Boolean) }, fetch),
  test: async (h) => {
    await (h as HomeAssistant).ping();
  },
  choices: {
    // Entities for the daily summary: people and doors first, the things worth a line in a journal.
    entities: async (h) => (await (h as HomeAssistant).states()).map((s) => ({ value: s.entity, label: s.name, group: s.entity.split(".")[0]!, note: s.state })),
  },
});

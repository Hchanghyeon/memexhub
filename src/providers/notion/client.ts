import { z } from "zod";
import { defineProvider } from "../types.js";
import { F, T } from "../../core/i18n.js";

export class NotionError extends Error {}

/** "https://www.notion.so/My-page-1a2b…" or a bare id → the 32-hex page id with dashes. */
export function pageIdOf(input: string): string | null {
  const hex = (input.match(/[0-9a-f]{32}(?![0-9a-f])/i)?.[0] ?? input.replace(/-/g, "").match(/^[0-9a-f]{32}$/i)?.[0])?.toLowerCase();
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : null;
}

export type NotionProps = Record<string, unknown>;

/**
 * Minimal Notion API client (data-source era): create a database under a page, create and update rows.
 * Waits and retries on 429 (Retry-After), keeps to ~3 requests per second.
 */
export class NotionClient {
  private last = 0;
  constructor(
    private o: { token: string; version: string; parentPage: string },
    private f: typeof fetch,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private now: () => number = () => Date.now(),
  ) {}

  get parentPageId() {
    const id = pageIdOf(this.o.parentPage);
    if (!id) throw new NotionError("the parent page is not a Notion page link or id");
    return id;
  }

  async call(method: string, path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = 340 - (this.now() - this.last);
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      const r = await this.f(`https://api.notion.com/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${this.o.token}`, "notion-version": this.o.version, "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (r.status === 429) {
        await this.sleep(Math.min(30, Number(r.headers.get("retry-after")) || 1) * 1000);
        continue;
      }
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) throw new NotionError(`Notion ${r.status}: ${String(j.code ?? "")} ${String(j.message ?? "").slice(0, 160)}`.trim());
      return j;
    }
    throw new NotionError("Notion keeps rate-limiting: try again later");
  }

  async createDatabase(title: string, properties: NotionProps): Promise<{ databaseId: string; dataSourceId: string }> {
    const j = await this.call("POST", "/databases", {
      parent: { type: "page_id", page_id: this.parentPageId },
      title: [{ type: "text", text: { content: title } }],
      initial_data_source: { properties },
    });
    const ds = j.data_sources?.[0]?.id;
    if (!j.id || !ds) throw new NotionError("Notion did not return a data source for the new database");
    return { databaseId: j.id, dataSourceId: ds };
  }

  async createRow(dataSourceId: string, properties: NotionProps): Promise<string> {
    return (await this.call("POST", "/pages", { parent: { type: "data_source_id", data_source_id: dataSourceId }, properties })).id;
  }

  async updateRow(pageId: string, properties: NotionProps): Promise<void> {
    await this.call("PATCH", `/pages/${encodeURIComponent(pageId)}`, { properties });
  }

  /** Connection test: the integration can see the parent page. */
  async check() {
    await this.call("GET", `/pages/${this.parentPageId}`);
  }
}

export const notionProvider = defineProvider({
  kind: "notion",
  id: "notion",
  title: T("Notion", "Notion"),
  config: z.object({
    parentPage: z.string().min(32).max(300).meta(F("Notion page for the databases", "데이터베이스를 만들 Notion 페이지", ["memexhub creates its databases (payments, health) under this page. Paste the link, then on the page: ⋯ → Connections → add your integration.", "memexhub가 이 페이지 아래에 결제·건강 데이터베이스를 만들어요. 링크를 붙여 넣고, 그 페이지 ⋯ → 연결(Connections)에서 내 통합을 추가하세요."])),
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2025-09-03").meta(F("Notion API version", "Notion API 버전", ["Leave as it is unless Notion asks for a newer one.", "Notion이 새 버전을 요구하지 않는 한 그대로 두세요."])),
  }),
  secrets: z.object({ token: z.string().min(20).meta(F("Internal integration secret", "내부 통합 시크릿", ["notion.so/my-integrations → New integration → copy the Internal integration secret (starts with ntn_).", "notion.so/my-integrations → 새 통합 만들기 → 내부 통합 시크릿을 복사하세요 (ntn_ 으로 시작해요)."])) }),
  runtimes: ["node", "workers"],
  hosts: () => ["api.notion.com"],
  create: ({ config, secrets, fetch }) => new NotionClient({ token: secrets.token, version: config.version, parentPage: config.parentPage }, fetch),
  test: async (n) => {
    await (n as NotionClient).check();
  },
});

import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import { StorageError, type FileInfo, type VaultStorage } from "../../storage/types.js";
import { Cursors } from "../../core/cursors.js";
import type { Db } from "../../platform/types.js";
import { NotionClient } from "./client.js";
import { blocksToMarkdown, markdownToBlocks } from "./markdown.js";

/**
 * The vault in Notion: one database, one page per note. "Path" (title) is the vault path, "Size" the note's
 * length, the page's last_edited_time is the etag. Bodies convert losslessly (see markdown.ts).
 * Suits small vaults: every read is a few requests at ~3 per second, and search reads every note.
 */
export class NotionVault implements VaultStorage {
  readonly id = "notion";
  capabilities = { search: false, etag: true };
  private target?: Promise<{ databaseId: string; dataSourceId: string }>;

  constructor(
    private n: NotionClient,
    private cursors: Cursors,
    private key: string,
  ) {}

  private ds() {
    return (this.target ??= (async () => {
      const have = await this.cursors.get<{ databaseId: string; dataSourceId: string }>(this.key);
      if (have) return have;
      const created = await this.n.createDatabase("memexhub vault", { Path: { title: {} }, Size: { number: { format: "number" } } });
      await this.cursors.set(this.key, created);
      return created;
    })());
  }

  private info(p: any): FileInfo {
    return {
      path: (p.properties?.Path?.title ?? []).map((r: any) => r.plain_text ?? r.text?.content ?? "").join(""),
      size: p.properties?.Size?.number ?? 0,
      mtime: new Date(p.last_edited_time),
      etag: p.last_edited_time,
    };
  }

  private async find(path: string): Promise<any | undefined> {
    const { dataSourceId } = await this.ds();
    const r = await this.n.call("POST", `/data_sources/${dataSourceId}/query`, { filter: { property: "Path", title: { equals: path } }, page_size: 2 });
    return (r.results ?? []).find((p: any) => !p.in_trash && !p.archived);
  }

  private async children(pageId: string) {
    const out: any[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 1000; i++) {
      const r = await this.n.call("GET", `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
      out.push(...(r.results ?? []));
      if (!r.has_more || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
    return out;
  }

  private async append(pageId: string, text: string) {
    const blocks = markdownToBlocks(text);
    for (let i = 0; i < blocks.length; i += 100) await this.n.call("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100).map((b) => ({ object: "block", ...b })) });
  }

  async read(path: string) {
    const p = await this.find(path);
    if (!p) throw new StorageError("not_found", `${path}: not found`);
    return { text: blocksToMarkdown(await this.children(p.id)), etag: p.last_edited_time as string };
  }

  async write(path: string, text: string, opts: { ifMatch?: string; ifNoneMatch?: "*" } = {}) {
    const p = await this.find(path);
    if (opts.ifNoneMatch && p) throw new StorageError("exists", `${path}: already exists`);
    if (opts.ifMatch && p && p.last_edited_time !== opts.ifMatch) throw new StorageError("conflict", `${path}: changed meanwhile`);
    const props = { Path: { title: [{ type: "text", text: { content: path } }] }, Size: { number: new TextEncoder().encode(text).length } };
    let id: string;
    if (p) {
      id = p.id;
      for (const b of await this.children(id)) await this.n.call("DELETE", `/blocks/${b.id}`);
      await this.n.call("PATCH", `/pages/${id}`, { properties: props });
    } else {
      id = await this.n.createRow((await this.ds()).dataSourceId, props);
    }
    await this.append(id, text);
    const now = await this.n.call("GET", `/pages/${id}`);
    return { etag: now.last_edited_time as string };
  }

  async list(dir = ""): Promise<FileInfo[]> {
    const { dataSourceId } = await this.ds();
    const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
    const out: FileInfo[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 1000; i++) {
      const r = await this.n.call("POST", `/data_sources/${dataSourceId}/query`, {
        page_size: 100,
        ...(prefix ? { filter: { property: "Path", title: { starts_with: prefix } } } : {}),
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const p of r.results ?? []) if (!p.in_trash && !p.archived) out.push(this.info(p));
      if (!r.has_more || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
    return out.filter((f) => f.path.startsWith(prefix));
  }

  async stat(path: string) {
    const p = await this.find(path);
    return p ? { ...this.info(p), path } : null;
  }

  async move(from: string, to: string) {
    const src = await this.find(from);
    if (!src) throw new StorageError("not_found", `${from}: not found`);
    if (await this.find(to)) throw new StorageError("exists", `${to}: already exists`);
    await this.n.call("PATCH", `/pages/${src.id}`, { properties: { Path: { title: [{ type: "text", text: { content: to } }] } } });
  }
}

export const notionVaultProvider = defineProvider({
  kind: "storage",
  id: "notion",
  title: T("Notion (beta: small vaults)", "Notion (베타: 작은 볼트용)"),
  config: z.object({
    parentPage: z.string().min(32).max(300).describe("Page that will hold the vault database (link or id): share it with your integration"),
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2025-09-03").describe("Notion API version"),
  }),
  secrets: z.object({ token: z.string().min(20).describe("Internal integration secret") }),
  runtimes: ["node", "workers"],
  hosts: () => ["api.notion.com"],
  create: ({ config, secrets, fetch, platform, connection }) =>
    new NotionVault(new NotionClient({ token: secrets.token, version: config.version, parentPage: config.parentPage }, fetch), new Cursors(platform.db as Db, () => platform.now()), `notion.vault:${connection.id}`),
  test: async (s) => {
    await s.list();
  },
});

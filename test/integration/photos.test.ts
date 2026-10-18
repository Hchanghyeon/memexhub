import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { testFs } from "../helpers.js";
import { PhotoFolder, folderPhotosProvider } from "../../src/providers/photos/folder.js";
import { dropBursts, spread } from "../../src/modules/photos/index.js";

const ROOT = mkdtempSync(join(tmpdir(), "mx-ph-"));
const LIB = join(ROOT, "lib");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
/** A file in the fake phone backup, "taken" at a Seoul wall-clock time. */
const put = (rel: string, seoul: string, bytes: Uint8Array = JPEG) => {
  const full = join(LIB, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, bytes);
  const t = new Date(`${seoul}+09:00`);
  utimesSync(full, t, t);
};
const thumb = (rel: string) => {
  const dir = join(LIB, rel, "..", "@eaDir", rel.split("/").pop()!);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SYNOPHOTO_THUMB_M.jpg"), JPEG);
};

let hub: Hub;
beforeAll(async () => {
  put("2026/10/IMG_1.heic", "2026-10-16T12:21:00"); thumb("2026/10/IMG_1.heic");
  put("2026/10/IMG_2.heic", "2026-10-16T12:21:02"); thumb("2026/10/IMG_2.heic"); // a burst of IMG_1
  put("2026/10/IMG_3.PNG", "2026-10-16T19:05:00");
  put("2026/10/IMG_4.MOV", "2026-10-16T19:10:00");
  put("2026/10/IMG_5.heic", "2026-10-16T20:00:00"); // no thumbnail, no preview
  put("2026/10/R1.DNG", "2026-10-16T21:00:00");
  put("2026/10/IMG_6.JPG", "2026-10-17T09:00:00");
  put("2025/03/OLD.JPG", "2025-03-01T09:00:00");
  // Folders keep old times when only deeper folders change (as on a real backup).
  for (const d of ["", "2026", "2025", "2025/03"]) utimesSync(join(LIB, d), new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-phd-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-16T13:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-phv-"))), folderPhotosProvider({ roots: [ROOT] })]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.connections.upsert({ kind: "photos", provider: "folder", name: "phone", config: { path: LIB } }, "t");
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("modules", { photos: { enabled: true }, hub: { enabled: true } });
  await hub.reload();
});

describe("photo folder", () => {
  const f = new PhotoFolder(LIB);
  it("lists a day's pictures by time, with kinds, skipping RAW files", async () => {
    const day = await f.list(new Date("2026-10-15T15:00:00Z"), new Date("2026-10-16T15:00:00Z"));
    expect(day.map((p) => `${p.name}:${p.kind}`)).toEqual(["IMG_1.heic:photo", "IMG_2.heic:photo", "IMG_3.PNG:screenshot", "IMG_4.MOV:video", "IMG_5.heic:photo"]);
  });
  it("previews from the photo app's thumbnail or a small original, never outside the folder", async () => {
    expect((await f.preview("2026/10/IMG_1.heic"))?.mimeType).toBe("image/jpeg");
    expect((await f.preview("2026/10/IMG_6.JPG"))?.bytes.length).toBe(JPEG.length);
    expect(await f.preview("2026/10/IMG_5.heic")).toBeUndefined();
    expect(await f.preview("../../etc/passwd")).toBeUndefined();
  });
  it("refuses a folder outside PHOTO_ROOTS", async () => {
    await hub.connections.upsert({ kind: "photos", provider: "folder", name: "bad", config: { path: "/etc" } }, "t");
    await hub.reload();
    const bad = (await hub.connections.get("photos", "bad"))!.id;
    expect(await hub.testConnection(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/must be under/) });
    await hub.connections.remove(bad, "t");
    await hub.reload();
  });
  it("drops bursts and spreads a long list", () => {
    const p = (s: string) => ({ id: s, name: s, kind: "photo" as const, takenAt: `2026-10-16T03:00:${s}Z` });
    expect(dropBursts([p("00"), p("02"), p("09")]).map((x) => x.id)).toEqual(["00", "09"]);
    expect(spread([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
  });
});

describe("photos_day", () => {
  it("gives Claude previews as MCP images, with the rules for filing them", async () => {
    const server = await hub.buildMcpServer("t");
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = (await client.callTool({ name: "photos_day", arguments: { date: "2026-10-16" } })) as { content: { type: string; text?: string; mimeType?: string }[] };
    expect(r.content.map((c) => c.type)).toEqual(["text", "image", "image"]);
    expect(r.content.slice(1).map((c) => c.mimeType)).toEqual(["image/jpeg", "image/png"]);
    const text = r.content[0]!.text!;
    expect(text).toContain("2026-10-16: 5 (photos 3 · screenshots 1 · videos 1), showing 2");
    expect(text).toContain("[1] 12:21 photo IMG_1.heic");
    expect(text).toContain("[2] 19:05 screenshot IMG_3.PNG");
    expect(text).toContain("meal_add");
    const lunch = (await client.callTool({ name: "photos_day", arguments: { date: "2026-10-16", from: "19:00", to: "21:00", kinds: ["photo"] } })) as { content: { text?: string }[] };
    expect(lunch.content[0]!.text).toContain("[-] 20:00 photo IMG_5.heic (no preview)");
  });
  it("shows a count in day_summary", async () => {
    expect(String(await hub.tools.find((t) => t.name === "day_summary")!.run({ date: "2026-10-16" }, { actor: "t" }))).toContain("📷 photos 3 · screenshots 1 · videos 1");
  });
});

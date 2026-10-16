import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

let hub: Hub, a: ReturnType<typeof adminClient>;
const dir = mkdtempSync(join(tmpdir(), "mx-vv-"));

beforeAll(async () => {
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  writeFileSync(join(dir, "notes", "Hello.md"), "---\ntitle: Hello\n---\n# Hello\nSee [[World]].\n");
  writeFileSync(join(dir, "World.md"), "# World\nsample text\n");
  writeFileSync(join(dir, ".obsidian", "app.json"), "{}");
  writeFileSync(join(dir, ".obsidian", "hidden.md"), "# hidden");
  mkdirSync(join(dir, "files"), { recursive: true });
  writeFileSync(join(dir, "files", "scan 1.pdf"), "%PDF-1.4 fake");
  writeFileSync(join(dir, "files", "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, "files", "draw.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  writeFileSync(join(dir, "files", "run.sh"), "echo hi");
  writeFileSync(join(dir, ".obsidian", "secret.png"), "x");
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-vvd-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date(), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(dir)]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.reload();
  a = adminClient(hub);
  await a.login();
});

describe("vault viewer API", () => {
  it("lists files without hidden folders, reads notes, searches", async () => {
    const { files } = await a.json("/vault/files");
    expect(files.map((f: { path: string }) => f.path)).toEqual(["files/draw.svg", "files/photo.png", "files/run.sh", "files/scan 1.pdf", "notes/Hello.md", "World.md"]);
    expect((await a.json("/vault/note?path=notes/Hello.md")).text).toContain("See [[World]].");
    expect((await a.json("/vault/search?q=sample")).hits.map((h: { path: string }) => h.path)).toEqual(["World.md"]);
  });

  it("refuses paths outside the vault, non-notes, and missing notes", async () => {
    for (const p of ["../etc/passwd.md", "/etc/passwd.md", ".obsidian/app.json", ".obsidian/hidden.md", "notes/../../x.md"]) {
      const r = await a.get(`/vault/note?path=${encodeURIComponent(p)}`);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await r.json())).not.toContain("{}");
    }
    expect((await a.get("/vault/note?path=nope.md")).status).toBe(404);
    expect((await a.get("/vault/note")).status).toBe(400);
  });

  it("serves pictures and PDFs inline, safely", async () => {
    const pdf = await a.get(`/vault/file?path=${encodeURIComponent("files/scan 1.pdf")}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''scan%201.pdf");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await pdf.text()).toBe("%PDF-1.4 fake");
    const png = await a.get("/vault/file?path=files/photo.png");
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    // An SVG with script must not run on our origin.
    const svg = await a.get("/vault/file?path=files/draw.svg");
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("refuses other file types, hidden folders, escapes and missing files", async () => {
    for (const p of ["files/run.sh", "notes/Hello.md", ".obsidian/secret.png", "../etc/x.png", "files/../../x.png"]) {
      const r = await a.get(`/vault/file?path=${encodeURIComponent(p)}`);
      expect(r.status, p).toBe(400);
    }
    expect((await a.get("/vault/file?path=files/nope.pdf")).status).toBe(404);
    expect((await a.get(`/vault/file?path=${encodeURIComponent("files/%2e%2e/World.png")}`)).status).toBe(404); // taken literally, never decoded twice
    expect((await a.get("/vault/file")).status).toBe(400);
  });

  it("builds the search index on request and searches through it", async () => {
    expect((await a.json("/vault")).search).toMatchObject({ available: true });
    const r = await a.post("/vault/search-index/rebuild");
    expect(r.status).toBe(200);
    expect((await r.json()).notes).toBe(2);
    expect((await a.json("/vault")).search).toMatchObject({ available: true, ready: true, notes: 2 });
    expect((await a.json("/vault/search?q=sample")).hits.map((h: { path: string }) => h.path)).toEqual(["World.md"]);
    expect((await adminClient(hub).post("/vault/search-index/rebuild")).status).toBe(401);
  });

  it("needs a signed-in admin", async () => {
    const anon = adminClient(hub);
    expect((await anon.get("/vault/files")).status).toBe(401);
    expect((await anon.get("/vault/note?path=World.md")).status).toBe(401);
    expect((await anon.get("/vault/file?path=files/photo.png")).status).toBe(401);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layout, PRESETS } from "../../src/modules/wiki/layout.js";
import { gateWikiWrite, setFrontmatter } from "../../src/modules/wiki/gate.js";
import { pendingSources, saveSource } from "../../src/modules/wiki/upkeep.js";
import { SafeVault } from "../../src/storage/safe-vault.js";
import { FsStorage } from "../../src/storage/fs.js";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { vaultTools } from "../../src/modules/vault/index.js";
import wiki from "../../src/modules/wiki/index.js";
import { SettingsSchema } from "../../src/core/settings.js";

let v: SafeVault;
const L = new Layout(PRESETS["llm-wiki"]!);
const page = (body: string, fm = "title: Seeds\nsources: [\"[[2026-01-02 Seed list]]\"]") => `---\n${fm}\n---\n${body}\n`;
beforeEach(async () => {
  const db = sqliteDb(":memory:");
  await migrate(db);
  v = new SafeVault(new FsStorage(mkdtempSync(join(tmpdir(), "mx-gate-"))), { readOnly: false, protectedPaths: L.protectedGlobs(), writeOncePaths: L.writeOnceGlobs(), maxWriteBytes: 1e6 }, db, "t");
  await saveSource(v, L, { title: "Seed list", content: "Tomatoes in March.", date: "2026-01-02" });
});

describe("wiki write gate", () => {
  it("leaves notes outside the wiki alone", async () => {
    expect(await gateWikiWrite(v, L, "journal/today.md", "no frontmatter")).toEqual({ text: "no frontmatter", notes: [] });
  });

  it("refuses a wiki page without frontmatter or without an existing source (fail closed)", async () => {
    await expect(gateWikiWrite(v, L, "wiki/Seeds.md", "# Seeds\nfrom [[2026-01-02 Seed list]]")).rejects.toMatchObject({ code: "invalid" });
    await expect(gateWikiWrite(v, L, "wiki/Seeds.md", page("No source here.", "title: Seeds"))).rejects.toThrow(/cites no existing source/);
    await expect(gateWikiWrite(v, L, "wiki/Seeds.md", page("Made up [[2026-01-03 Not saved]].", "title: Seeds"))).rejects.toThrow(/cites no existing source/);
  });

  it("marks pages draft — Claude cannot make a page stable, but may deprecate it — and reports broken links", async () => {
    const r = await gateWikiWrite(v, L, "wiki/Seeds.md", page("Tomatoes in March [[2026-01-02 Seed list]]. See [[Garden]].", "title: Seeds\nstatus: stable"));
    expect(r.text).toContain("status: draft");
    expect(r.text).not.toContain("status: stable");
    expect(r.notes.join("\n")).toMatch(/missing notes: \[\[Garden\]\]/);
    const d = await gateWikiWrite(v, L, "wiki/Old.md", page("Was [[2026-01-02 Seed list]].", "title: Old\nstatus: deprecated"));
    expect(d.text).toContain("status: deprecated");
  });

  it("lets sub-index pages (type: index / area / moc) list pages without a source or status", async () => {
    const t = "---\ntitle: Wiki - basics\ntype: area\n---\n- [[Seeds]] — seeds\n";
    expect(await gateWikiWrite(v, L, "wiki/Wiki - basics.md", t)).toEqual({ text: t, notes: [] });
  });

  it("sets a frontmatter key without touching the rest", () => {
    const t = "---\ntitle: A\ntags: [x]\n---\nbody\n";
    expect(setFrontmatter(t, "status", "draft")).toBe("---\ntitle: A\ntags: [x]\nstatus: draft\n---\nbody\n");
    expect(setFrontmatter(setFrontmatter(t, "status", "draft"), "status", "stable")).toBe("---\ntitle: A\ntags: [x]\nstatus: stable\n---\nbody\n");
    expect(() => setFrontmatter("body", "status", "x")).toThrow();
  });

  it("applies to write_note and to append_note as a whole page", async () => {
    const tools = vaultTools(v, (vv, p, t) => gateWikiWrite(vv, L, p, t));
    const write = tools.find((t) => t.name === "write_note")!;
    const append = tools.find((t) => t.name === "append_note")!;
    await expect(write.run({ path: "wiki/Seeds.md", content: "# no fm", overwrite: true } as any, { actor: "c" })).rejects.toBeTruthy();
    expect(await write.run({ path: "wiki/Seeds.md", content: page("From [[2026-01-02 Seed list]]."), overwrite: true } as any, { actor: "c" })).toContain("status: draft");
    await v.confirmedByAdmin().write("wiki/Seeds.md", setFrontmatter((await v.read("wiki/Seeds.md")).text, "status", "stable"));
    expect(await append.run({ path: "wiki/Seeds.md", content: "More." } as any, { actor: "c" })).toContain("status: draft");
    expect((await v.read("wiki/Seeds.md")).text).toMatch(/status: draft[\s\S]*More\.\n?$/);
    expect(await append.run({ path: "journal/x.md", content: "plain" } as any, { actor: "c" })).toBe("created: journal/x.md");
  });

  it("lists sources no wiki page cites, and checks one page", async () => {
    expect(await pendingSources(v, L)).toEqual(["raw/2026-01-02 Seed list.md"]);
    const tools = (await wiki.setup({ settings: SettingsSchema.parse({ wiki: { roles: PRESETS["llm-wiki"] } }), vault: v } as any)).tools!;
    const check = tools.find((t) => t.name === "wiki_check")!;
    await v.write("wiki/Seeds.md", page("From [[2026-01-02 Seed list]].", "title: Seeds\ncreated: 2026-01-02\nupdated: 2026-01-02\nstatus: draft"));
    await v.write("wiki/index.md", "- [[Seeds]] — seed list\n");
    expect(await check.run({ path: "wiki/Seeds.md" } as any, { actor: "c" })).toBe("PASS wiki/Seeds.md (status: draft)");
    await v.write("wiki/Bad.md", page("Nothing cited [[Nope]].", "title: Bad"));
    const bad = await check.run({ path: "wiki/Bad.md" } as any, { actor: "c" });
    expect(bad).toMatch(/^FAIL wiki\/Bad\.md/);
    expect(bad).toMatch(/page-status/);
    expect(bad).toMatch(/broken-links/);
    expect(bad).toMatch(/wiki-page-without-source/);
    expect(await pendingSources(v, L)).toEqual([]);
    const pending = tools.find((t) => t.name === "wiki_pending")!;
    expect(await pending.run({ limit: 30 } as any, { actor: "c" })).toContain("every source is cited");
  });

  it("saves a conversation's decisions, facts and to-dos as a short source — and nothing for small talk", async () => {
    const tools = (await wiki.setup({ settings: SettingsSchema.parse({ wiki: { roles: PRESETS["llm-wiki"] }, ledger: { language: "ko" }, timezone: "Asia/Seoul" }), vault: v, platform: { now: () => new Date("2026-10-16T03:00:00Z") } } as any)).tools!;
    const save = tools.find((t) => t.name === "conversation_save")!;
    expect(await save.run({ title: "x", decisions: [], facts: [], todos: [] } as any, { actor: "c" })).toMatch(/not saved/);
    const r = await save.run({ title: "검색 색인", decisions: ["벡터 검색은 보류"], facts: [], todos: ["context 도구"], context: "토큰 걱정" } as any, { actor: "c" });
    const path = String(r).match(/saved: (\S+ .*?\.md)/)![1]!;
    expect(path).toBe("raw/2026-10-16 대화 - 검색 색인.md");
    const text = (await v.read(path)).text;
    expect(text).toContain("type: source");
    expect(text).toContain("> 맥락: 토큰 걱정\n\n## 결정\n- 벡터 검색은 보류\n\n## 남은 일\n- [ ] context 도구\n");
    expect(text).not.toContain("## 새로 안 것");
    expect(await pendingSources(v, L)).toContain(path);
  });
});

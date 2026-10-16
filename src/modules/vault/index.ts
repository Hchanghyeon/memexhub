import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import type { SafeVault } from "../../storage/safe-vault.js";
import { Layout } from "../wiki/layout.js";
import { gateWikiWrite } from "../wiki/gate.js";

/** Runs before a tool writes a note; may change the text (e.g. mark a wiki page draft) or refuse. */
export type WriteGate = (vault: SafeVault, path: string, text: string) => Promise<{ text: string; notes: string[] }>;

const fmtDate = (d: Date) => d.toISOString().slice(0, 19);

export function vaultTools(vault: SafeVault, gate?: WriteGate) {
  return [
    defineTool({
      name: "list_notes",
      readOnly: true,
      description: T("List notes, most recently modified first.", "노트 목록을 최근 수정순으로 돌려준다."),
      input: {
        folder: z.string().default("").describe("Sub-folder, empty = whole vault / 하위 폴더, 비우면 전체"),
        pattern: z.string().default("*.md").describe("File name glob / 파일명 glob"),
        limit: z.number().int().min(1).max(500).default(200),
      },
      async run({ folder, pattern, limit }) {
        const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
        const files = (await vault.list(folder || undefined))
          .filter((f) => re.test(f.path.split("/").pop() ?? ""))
          .sort((a, b) => +b.mtime - +a.mtime)
          .slice(0, limit);
        return `${files.length}\n` + files.map((f) => `${f.path}  (${f.size}B, ${fmtDate(f.mtime)})`).join("\n");
      },
    }),
    defineTool({
      name: "read_note",
      readOnly: true,
      description: T("Read a whole note. Path is relative to the vault root.", "노트 하나의 전체 내용을 읽는다. path 는 볼트 기준 상대 경로."),
      input: { path: z.string() },
      async run({ path }) {
        return (await vault.read(path)).text;
      },
    }),
    defineTool({
      name: "search_notes",
      readOnly: true,
      description: T(
        "Full-text search across the vault. Returns matching lines per note. Use this before opening notes.",
        "볼트 전체 본문 검색. 노트별 매칭 줄을 돌려준다. 노트를 열기 전에 먼저 쓴다.",
      ),
      input: {
        query: z.string().min(1),
        regex: z.boolean().default(false),
        case_sensitive: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(30),
      },
      async run({ query, regex, case_sensitive, limit }) {
        const hits = await vault.search(query, { regex, caseSensitive: case_sensitive, limit });
        if (!hits.length) return "no matches";
        return `${hits.length} notes\n\n` + hits.map((h) => `## ${h.path}\n` + h.lines.map((l) => `  L${l.n}: ${l.text}`).join("\n")).join("\n");
      },
    }),
    defineTool({
      name: "vault_stats",
      readOnly: true,
      description: T("Vault summary: file count, note count, total size.", "볼트 요약 — 파일 수, 노트 수, 전체 크기."),
      input: {},
      async run() {
        const files = await vault.list();
        const kb = files.reduce((s, f) => s + f.size, 0) / 1024;
        return `files ${files.length} · notes ${files.filter((f) => f.path.endsWith(".md")).length} · ${kb.toFixed(1)}KB`;
      },
    }),
    defineTool({
      name: "write_note",
      description: T(
        "Create or overwrite a note. With overwrite=false it fails if the note exists. Protected paths cannot be written.",
        "노트를 만들거나 덮어쓴다. overwrite=false 면 이미 있을 때 실패한다. 보호 경로는 쓸 수 없다.",
      ),
      input: { path: z.string(), content: z.string(), overwrite: z.boolean().default(true) },
      async run({ path, content, overwrite }, ctx) {
        const v = vault.withActor(ctx.actor);
        const g = gate ? await gate(v, path, content) : { text: content, notes: [] };
        const r = await v.write(path, g.text, { overwrite });
        return [`${r.created ? "created" : r.changed ? "overwritten" : "unchanged"}: ${r.path}`, ...g.notes].join("\n");
      },
    }),
    defineTool({
      name: "append_note",
      description: T("Append to the end of a note; creates it if missing.", "노트 끝에 내용을 덧붙인다. 없으면 새로 만든다."),
      input: { path: z.string(), content: z.string() },
      async run({ path, content }, ctx) {
        const v = vault.withActor(ctx.actor);
        if (gate) {
          // A wiki page is checked as a whole: what it will look like after the append.
          const cur = await v.read(path).then((x) => x.text, () => "");
          const g = await gate(v, path, cur + (cur === "" || cur.endsWith("\n") ? "" : "\n") + content);
          if (g.notes.length) {
            const r = await v.write(path, g.text, { overwrite: true });
            return [`${r.created ? "created" : "appended"}: ${r.path}`, ...g.notes].join("\n");
          }
        }
        const r = await v.append(path, content);
        return `${r.created ? "created" : "appended"}: ${r.path}`;
      },
    }),
    defineTool({
      name: "delete_note",
      destructive: true,
      description: T("Move a note to .trash/ (never deleted for real).", "노트를 휴지통(.trash)으로 옮긴다. 실제로 지우지는 않는다."),
      input: { path: z.string() },
      async run({ path }, ctx) {
        const r = await vault.withActor(ctx.actor).trash(path);
        return `moved to trash: ${r.path} → ${r.movedTo}`;
      },
    }),
    defineTool({
      name: "move_note",
      destructive: true,
      description: T("Move or rename a note. Fails if the destination exists.", "노트를 옮기거나 이름을 바꾼다. 대상이 이미 있으면 실패한다."),
      input: { src: z.string(), dst: z.string() },
      async run({ src, dst }, ctx) {
        const r = await vault.withActor(ctx.actor).move(src, dst);
        return `moved: ${r.from} → ${r.to}`;
      },
    }),
  ];
}

export default defineModule({
  id: "vault",
  title: T("Vault", "볼트"),
  needs: ["vault"],
  setup: ({ vault, settings }) => {
    const layout = new Layout(settings.wiki.roles);
    const on = settings.wiki.gate ?? !!layout.sources;
    return { tools: vaultTools(vault!, on ? (v, p, t) => gateWikiWrite(v, layout, p, t) : undefined) };
  },
});

import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { z } from "zod";
import { Layout } from "./layout.js";
import { LinkGraph } from "./graph.js";
import { effectiveRules, formatFindings, lint, RULES } from "./lint.js";
import { addToIndex, appendLog, backlinks, saveSource, today } from "./upkeep.js";

export default defineModule({
  id: "wiki",
  title: T("Wiki engine", "위키 엔진"),
  needs: ["vault"],
  setup: ({ settings, vault }) => {
    const layout = new Layout(settings.wiki.roles);
    const enabledRules = effectiveRules(settings.wiki.lint).filter((x) => x.enabled).map((x) => x.rule.id);
    return {
      tools: [
        defineTool({
          name: "wiki_layout",
          readOnly: true,
          description: T(
            "How this vault is organized: where sources, wiki pages, indexes, the log, daily notes and protected rule notes live, and which lint rules are on. Call this before filing notes.",
            "이 볼트의 구조 — 원본, 위키 페이지, 목차, 로그, 일지, 보호된 규칙 노트의 위치와 켜진 점검 규칙. 노트를 넣기 전에 먼저 부른다.",
          ),
          input: {},
          async run() {
            return `${layout.describe()}\npreset: ${settings.wiki.preset ?? "(custom)"}\nlint rules on: ${enabledRules.join(", ") || "(none)"}`;
          },
        }),
        defineTool({
          name: "wiki_lint",
          readOnly: true,
          description: T(
            "Check the vault: broken links, orphan pages, missing index entries, oversized pages, long indexes, required frontmatter, unregistered tags, pages without a source, bad file names. Exact, no guessing. Report findings to the user before fixing.",
            "볼트 점검 — 깨진 링크, 고아 페이지, 목차 누락, 큰 페이지, 긴 목차, 필수 프론트매터, 등록 안 된 태그, 원본 없는 페이지, 잘못된 파일명. 정확한 검사. 고치기 전에 결과를 먼저 사용자에게 보고한다.",
          ),
          input: {
            rules: z.array(z.enum(RULES.map((r) => r.id) as [string, ...string[]])).optional().describe("Only these rules / 이 규칙만"),
            per_rule: z.number().int().min(1).max(200).default(20),
          },
          async run({ rules, per_rule }) {
            const g = await LinkGraph.build(vault!);
            return formatFindings(lint(g, layout, settings.wiki.lint, rules), per_rule);
          },
        }),
        ...(layout.sources
          ? [
              defineTool({
                name: "wiki_save_source",
                description: T(
                  "Save an original (article, transcript, notes) into the sources folder unchanged, as 'YYYY-MM-DD title.md'. Sources are write-once. Afterwards write or update wiki pages that cite it.",
                  "원본(글, 녹취, 메모)을 원본 폴더에 그대로 'YYYY-MM-DD 제목.md' 로 저장한다. 원본은 한 번만 쓸 수 있다. 저장한 뒤 그걸 인용하는 위키 페이지를 쓰거나 고친다.",
                ),
                input: {
                  title: z.string().min(1).max(200),
                  content: z.string().max(400_000),
                  url: z.string().max(2000).optional(),
                  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Defaults to today / 기본은 오늘"),
                },
                async run({ title, content, url, date }, ctx) {
                  const path = await saveSource(vault!.withActor(ctx.actor), layout, { title, content, url, date: date ?? today(settings.timezone) });
                  return `saved source: ${path}`;
                },
              }),
            ]
          : []),
        ...(layout.roles.log
          ? [
              defineTool({
                name: "wiki_log",
                description: T("Append one dated line to the wiki log (append-only).", "위키 로그에 날짜가 붙은 한 줄을 추가한다 (추가만)."),
                input: { entry: z.string().min(1).max(500) },
                async run({ entry }, ctx) {
                  const r = await appendLog(vault!.withActor(ctx.actor), layout, entry, today(settings.timezone));
                  return `logged in ${r.log}: ${r.line}`;
                },
              }),
            ]
          : []),
        ...(layout.roles.index.style !== "none"
          ? [
              defineTool({
                name: "wiki_index",
                description: T(
                  "List a page in its index note as '- [[page]] — description' (skips if already listed). Optional section heading.",
                  "페이지를 목차 노트에 '- [[페이지]] — 설명' 으로 올린다 (이미 있으면 건너뜀). 섹션 제목을 줄 수 있다.",
                ),
                input: { path: z.string(), description: z.string().min(1).max(200), section: z.string().max(60).optional() },
                async run({ path, description, section }, ctx) {
                  const r = await addToIndex(vault!.withActor(ctx.actor), layout, { path, description, section });
                  return r.added ? `listed in ${r.index}` : `already listed in ${r.index}`;
                },
              }),
            ]
          : []),
        defineTool({
          name: "wiki_backlinks",
          readOnly: true,
          description: T("Notes that link to a note, with the linking line.", "이 노트를 가리키는 노트들과 그 줄."),
          input: { path: z.string() },
          async run({ path }) {
            const b = await backlinks(vault!, path);
            return b.length ? `${b.length} backlinks\n` + b.map((x) => `- ${x.from} L${x.line}: ${x.text}`).join("\n") : "no backlinks";
          },
        }),
      ],
    };
  },
});

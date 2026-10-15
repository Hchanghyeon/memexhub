import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { z } from "zod";
import { Layout } from "./layout.js";
import { LinkGraph } from "./graph.js";
import { effectiveRules, formatFindings, lint, RULES } from "./lint.js";

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
      ],
    };
  },
});

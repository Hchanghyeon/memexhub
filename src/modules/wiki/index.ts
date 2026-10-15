import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { Layout } from "./layout.js";

export default defineModule({
  id: "wiki",
  title: T("Wiki engine", "위키 엔진"),
  needs: ["vault"],
  setup: ({ settings }) => {
    const layout = new Layout(settings.wiki.roles);
    const enabledRules = Object.entries(settings.wiki.lint).filter(([, r]) => r.enabled).map(([id]) => id);
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
      ],
    };
  },
});

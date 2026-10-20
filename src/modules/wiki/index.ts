import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import { z } from "zod";
import { Layout } from "./layout.js";
import { LinkGraph } from "./graph.js";
import { effectiveRules, formatFindings, lint, RULES } from "./lint.js";
import { addToIndex, appendLog, backlinks, conversationNote, pendingSources, safeTitle, saveSource, sharedNote, today } from "./upkeep.js";
import { nowIn } from "../../core/time.js";
import { normalizeVaultPath } from "../../storage/paths.js";
import { setFrontmatter } from "./gate.js";

/** How Claude should work the wiki (the LLM Wiki loop). Vault rule notes add the owner's own rules on top. */
const WORKFLOW = [
  "how to work:",
  "- ingest: save an original with wiki_save_source (never edited), then update or create every wiki page it touches: one source can change many pages. Each claim links its source note ([[…]]). wiki_pending lists sources no page cites yet.",
  "- conflicts: when sources disagree, keep both in a '> [!warning] Conflict' callout naming each source and date; follow the trust order in the vault's rule notes (official documents > what the owner wrote > notes and chats > your own inference).",
  "- status: pages you write are saved as status: draft until the owner confirms them in the admin UI (stable). Mark outdated pages status: deprecated instead of deleting them.",
  "- check: after writing, run wiki_check on each page and fix it until it passes; then read the cited sources again and make sure every sentence is really in them.",
  "- answers: when an answer combines several notes, offer to save it as a wiki page (with its sources).",
  "- log every ingest with wiki_log.",
].join("\n");

const Shared = z.object({
  url: z.string().max(2000).optional(),
  text: z.string().max(20_000).optional(),
  title: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
});

export default defineModule({
  id: "wiki",
  title: T("Wiki engine", "위키 엔진"),
  needs: ["vault"],
  setup: ({ settings, vault, platform }) => {
    const layout = new Layout(settings.wiki.roles);
    const enabledRules = effectiveRules(settings.wiki.lint).filter((x) => x.enabled).map((x) => x.rule.id);
    return {
      tools: [
        defineTool({
          name: "wiki_layout",
          readOnly: true,
          description: T(
            "How this vault is organized: where sources, wiki pages, indexes, the log, daily notes and protected rule notes live, and which lint rules are on. Call this before filing notes.",
            "이 볼트의 구조: 원본, 위키 페이지, 목차, 로그, 일지, 보호된 규칙 노트의 위치와 켜진 점검 규칙. 노트를 넣기 전에 먼저 부른다.",
          ),
          input: {},
          async run() {
            const gate = settings.wiki.gate ?? !!layout.sources;
            return `${layout.describe()}\npreset: ${settings.wiki.preset ?? "(custom)"}\nlint rules on: ${enabledRules.join(", ") || "(none)"}\nwrite check: ${gate ? "on: wiki pages need frontmatter and an existing source, and are saved as draft" : "off"}\n\n${WORKFLOW}`;
          },
        }),
        defineTool({
          name: "wiki_lint",
          readOnly: true,
          description: T(
            "Check the vault: broken links, orphan pages, missing index entries, oversized pages, long indexes, required frontmatter, unregistered tags, pages without a source, bad file names. Exact, no guessing. Report findings to the user before fixing.",
            "볼트 점검: 깨진 링크, 고아 페이지, 목차 누락, 큰 페이지, 긴 목차, 필수 프론트매터, 등록 안 된 태그, 원본 없는 페이지, 잘못된 파일명. 정확한 검사. 고치기 전에 결과를 먼저 사용자에게 보고한다.",
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
                  const path = await saveSource(vault!.withActor(ctx.actor), layout, { title, content, url, date: date ?? today(settings.timezone, platform.now()) });
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
                  const r = await appendLog(vault!.withActor(ctx.actor), layout, entry, today(settings.timezone, platform.now()));
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
                  "List a page in its index note as '- [[page]]: description' (skips if already listed). Optional section heading.",
                  "페이지를 목차 노트에 '- [[페이지]]: 설명' 으로 올린다 (이미 있으면 건너뜀). 섹션 제목을 줄 수 있다.",
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
          name: "wiki_check",
          readOnly: true,
          description: T(
            "Check one wiki page the exact way the engine does: frontmatter, status, an existing source, broken links, size, index entry and the other lint rules. Returns PASS or what to fix. Run it after writing each page.",
            "위키 페이지 하나를 엔진 방식 그대로 점검: 프론트매터, 상태, 실제 원본 인용, 깨진 링크, 크기, 목차, 그 밖의 점검 규칙. 통과(PASS) 또는 고칠 것을 돌려준다. 페이지를 쓴 뒤마다 부른다.",
          ),
          input: { path: z.string().min(1).max(500) },
          async run({ path }) {
            const p = normalizeVaultPath(path);
            const g = await LinkGraph.build(vault!);
            const n = g.notes.get(p);
            if (!n) return `FAIL ${p}: no such note`;
            const problems = lint(g, layout, { ...settings.wiki.lint, ...Object.fromEntries(["page-status", "wiki-page-without-source", "frontmatter-required"].map((id) => [id, { ...settings.wiki.lint[id], enabled: true }])) })
              .filter((f) => f.path === p)
              .map((f) => `- ${f.rule}${f.line ? ` L${f.line}` : ""}: ${f.message}`);
            if (!layout.isWikiPage(p)) problems.unshift(`- note: ${p} is not in the wiki folder (${layout.wiki ?? "off"})`);
            return problems.length ? `FAIL ${p}\n${problems.join("\n")}` : `PASS ${p} (status: ${n.frontmatter.status ?? "?"})`;
          },
        }),
        ...(layout.sources
          ? [
              defineTool({
                name: "conversation_save",
                description: T(
                  "Save what this conversation decided: decisions, new facts about the user or their work, to-dos · as a short source note (write-once). The nightly ingest files the lasting parts into the wiki. Ask the user first; skip small talk.",
                  "이 대화에서 정한 것: 결정, 사용자나 그 일에 대한 새 사실, 남은 일 · 을 짧은 원본 노트로 저장한다 (한 번만 씀). 오래 쓸 부분은 밤 수집이 위키에 넣는다. 먼저 사용자에게 묻고, 잡담은 저장하지 않는다.",
                ),
                input: {
                  title: z.string().min(1).max(80).describe("What it was about, a few words / 무엇에 대한 대화인지 몇 단어"),
                  decisions: z.array(z.string().min(1).max(400)).max(10).default([]),
                  facts: z.array(z.string().min(1).max(400)).max(10).default([]),
                  todos: z.array(z.string().min(1).max(400)).max(10).default([]),
                  context: z.string().max(400).optional().describe("One line: why this came up / 한 줄: 어떤 상황이었는지"),
                },
                async run({ title, decisions, facts, todos, context }, ctx) {
                  if (!decisions.length && !facts.length && !todos.length) return "nothing to save: no decision, fact or to-do (not saved)";
                  const lang = settings.ledger.language;
                  const content = conversationNote({ decisions, facts, todos, context }, lang);
                  const path = await saveSource(vault!.withActor(ctx.actor), layout, { title: `${lang === "ko" ? "대화" : "Conversation"} - ${title}`, content, date: today(settings.timezone, platform.now()) });
                  return `saved: ${path} (${new TextEncoder().encode(content).length} bytes). The nightly ingest will file the lasting parts into the wiki.`;
                },
              }),
              defineTool({
                name: "wiki_pending",
                readOnly: true,
                description: T(
                  "Sources no wiki page cites yet: what is left to ingest, oldest first.",
                  "아직 어떤 위키 페이지도 인용하지 않은 원본: 정리할 차례인 것, 오래된 순.",
                ),
                input: { limit: z.number().int().min(1).max(200).default(30) },
                async run({ limit }) {
                  const list = await pendingSources(vault!, layout);
                  return list.length ? `${list.length} sources not yet in the wiki\n${list.slice(0, limit).map((x) => `- ${x}`).join("\n")}${list.length > limit ? `\n- … ${list.length - limit} more` : ""}` : "every source is cited by a wiki page ✓";
                },
              }),
            ]
          : []),
        defineTool({
          name: "wiki_review",
          readOnly: true,
          description: T(
            "Pages whose facts change and were not confirmed for a while (frontmatter review: <days>, or a tag set in the stale-facts rule), oldest first. For each: ask the user whether it is still true, or check newer records; then fix the page (move a replaced fact under a History section as \"before: … (until YYYY-MM)\" instead of deleting it) and call wiki_checked.",
            "내용이 바뀌는 페이지 중 한동안 확인 안 된 것 (프론트매터 review: <일수>, 또는 stale-facts 규칙에 정한 태그), 오래된 순. 하나씩: 아직 맞는지 사용자에게 묻거나 최근 기록으로 확인 → 페이지를 고치고 (바뀐 사실은 지우지 말고 이력 섹션에 \"이전: … (~YYYY-MM)\" 로) wiki_checked 를 부른다.",
          ),
          input: { limit: z.number().int().min(1).max(100).default(20) },
          async run({ limit }) {
            const g = await LinkGraph.build(vault!);
            const r = settings.wiki.lint["stale-facts"];
            const found = lint(g, layout, { "stale-facts": { enabled: true, options: r?.options } }, ["stale-facts"]);
            if (!found.length) return "no page is due for a check ✓";
            return [`${found.length} page(s) to confirm`, ...found.slice(0, limit).map((f) => `- ${f.path}: ${f.message}`), ...(found.length > limit ? [`- … ${found.length - limit} more`] : [])].join("\n");
          },
        }),
        defineTool({
          name: "wiki_checked",
          description: T(
            "Mark a page's facts as confirmed today (sets checked: YYYY-MM-DD in its frontmatter). Call after the user confirmed it or you updated it from newer records.",
            "페이지 내용을 오늘 확인했다고 표시 (프론트매터 checked: YYYY-MM-DD). 사용자가 맞다고 했거나 최근 기록으로 고친 뒤에 부른다.",
          ),
          input: { path: z.string().min(1).max(500) },
          async run({ path }, { actor }) {
            const p = normalizeVaultPath(path);
            const v = vault!.withActor(actor);
            const date = today(settings.timezone, platform.now());
            await v.write(p, setFrontmatter((await v.read(p)).text, "checked", date), { why: "checked" });
            return `checked: ${p} (${date})`;
          },
        }),
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
      ingest: layout.sources
        ? [
            {
              // The phone's share sheet (an iOS Shortcut or an Android share target): a link or text becomes a source note.
              path: "/ingest/share",
              scope: "share",
              maxBytes: 64 * 1024,
              async handle(body, { tokenId }) {
                const p = Shared.safeParse(body);
                if (!p.success || !(p.data.url?.trim() || p.data.text?.trim())) throw new Error("invalid payload");
                const now = platform.now();
                const w = nowIn(settings.timezone, now);
                const lang = settings.toolLanguage === "ko" ? "ko" : "en";
                const n = sharedNote({ ...p.data, time: `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}` }, lang);
                const v = vault!.withActor(`share:${tokenId}`);
                const date = today(settings.timezone, now);
                // A second share with the same title on the same day gets a number: sources are never overwritten.
                for (let i = 1; i <= 20; i++) {
                  const title = i === 1 ? n.title : `${n.title} (${i})`;
                  if (await v.stat(`${layout.sources}/${date} ${safeTitle(title)}.md`).catch(() => undefined)) continue;
                  return { saved: await saveSource(v, layout, { title, content: n.content, url: n.url, date }) };
                }
                throw new Error("too many notes with this title today");
              },
            },
          ]
        : [],
    };
  },
});

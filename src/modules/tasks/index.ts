import { z } from "zod";
import { defineModule, defineTool } from "../../core/registry.js";
import { T } from "../../core/i18n.js";
import type { Task, TaskProvider } from "../../providers/tasks/types.js";

const fmt = (t: Task) =>
  `${t.parent ? "  ↳ " : ""}${t.status === "completed" ? "✅" : "⬜"} ${t.title || "(untitled)"}${t.due ? ` · due ${t.due}` : ""}  [id ${t.id}]${t.notes ? `\n    notes: ${t.notes.slice(0, 200)}` : ""}`;

export default defineModule({
  id: "tasks",
  title: T("Tasks", "할 일"),
  setup: async ({ provider, connections }) => {
    const accounts = await connections("tasks");
    const account = z.string().max(32).describe(`Account / 계정: ${accounts.join(", ") || "-"}`);
    const tasklist = z.string().max(200).default("").describe("List name or id; empty = default list");
    const id = z.string().min(1).max(200);
    const get = async (a: string) => {
      const p = await provider<TaskProvider>("tasks", a);
      if (!p) throw new Error(`no tasks account named "${a}" (${accounts.join(", ") || "none connected"})`);
      return p;
    };
    const run = async (a: string, fn: (p: TaskProvider) => Promise<string>) => {
      try {
        return `[${a}] ${await fn(await get(a))}`;
      } catch (e) {
        return `error: ${(e as Error).message.slice(0, 300)}`;
      }
    };
    return {
      tools: [
        defineTool({
          name: "tasks_accounts",
          readOnly: true,
          description: T("Connected to-do accounts. Use these names as `account` in the other task tools.", "연결된 할 일 계정. 다른 할 일 도구의 account 에 이 이름을 쓴다."),
          input: {},
          async run() {
            return accounts.length ? accounts.map((a) => `- ${a}`).join("\n") : "no to-do accounts connected — admin UI → Connections → Google Tasks";
          },
        }),
        defineTool({
          name: "tasklists",
          readOnly: true,
          description: T("Task lists of an account (name and id).", "계정의 할 일 목록들 (이름·id)."),
          input: { account },
          async run(a) {
            return run(a.account, async (p) => (await p.lists()).map((l) => `- ${l.title}  [id ${l.id}]`).join("\n") || "no lists");
          },
        }),
        defineTool({
          name: "tasks_list",
          readOnly: true,
          description: T("Tasks in a list, open first by due date. Set show_completed to include done ones.", "목록의 할 일, 안 한 것부터 마감 순. show_completed 면 완료한 것도."),
          input: { account, tasklist, show_completed: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(100) },
          async run(a) {
            return run(a.account, async (p) => {
              const items = await p.list(a.tasklist, { showCompleted: a.show_completed, limit: a.limit });
              if (!items.length) return "no tasks";
              items.sort((x, y) => Number(x.status === "completed") - Number(y.status === "completed") || (x.due ?? "9999").localeCompare(y.due ?? "9999"));
              return `${items.length} tasks\n${items.map(fmt).join("\n")}`;
            });
          },
        }),
        defineTool({
          name: "task_add",
          readOnly: false,
          description: T("Add a task. If it is unclear which account, ask the user first. due: YYYY-MM-DD (date only).", "할 일을 추가한다. 어느 계정인지 애매하면 먼저 묻는다. due: YYYY-MM-DD (날짜만)."),
          input: { account, title: z.string().min(1).max(1024), notes: z.string().max(8192).optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tasklist },
          async run(a) {
            return run(a.account, async (p) => `added\n${fmt(await p.add(a.tasklist, { title: a.title.trim(), notes: a.notes, due: a.due }))}`);
          },
        }),
        defineTool({
          name: "task_update",
          readOnly: false,
          description: T('Change a task\'s title, notes or due date. Empty fields stay; due "none" removes the date.', '할 일의 제목·메모·마감을 바꾼다. 비운 칸은 그대로, due "none" 이면 마감을 지운다.'),
          input: { account, task_id: id, title: z.string().max(1024).optional(), notes: z.string().max(8192).optional(), due: z.string().regex(/^(\d{4}-\d{2}-\d{2}|none)$/).optional(), tasklist },
          async run(a) {
            return run(a.account, async (p) => `updated\n${fmt(await p.update(a.tasklist, a.task_id, { title: a.title, notes: a.notes, due: a.due === "none" ? null : a.due }))}`);
          },
        }),
        defineTool({
          name: "task_complete",
          readOnly: false,
          description: T("Mark a task done (undo = back to open).", "할 일을 완료로 (undo 면 다시 미완료로)."),
          input: { account, task_id: id, tasklist, undo: z.boolean().default(false) },
          async run(a) {
            return run(a.account, async (p) => `${a.undo ? "reopened" : "completed"}\n${fmt(await p.complete(a.tasklist, a.task_id, a.undo))}`);
          },
        }),
        defineTool({
          name: "task_delete",
          readOnly: false,
          destructive: true,
          description: T("Delete a task permanently. Only when the user clearly asked; usually task_complete is right.", "할 일을 영구히 지운다. 사용자가 분명히 지우라고 했을 때만 — 보통은 task_complete."),
          input: { account, task_id: id, tasklist },
          async run(a) {
            return run(a.account, async (p) => (await p.remove(a.tasklist, a.task_id), `deleted ${a.task_id}`));
          },
        }),
      ],
    };
  },
});

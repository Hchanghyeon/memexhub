import { z } from "zod";
import { defineProvider } from "../types.js";
import { T } from "../../core/i18n.js";
import type { Task, TaskList, TaskProvider } from "./types.js";
import { GOOGLE, GoogleError, GoogleToken } from "../google/auth.js";

export { GoogleError };
const TASKS = "https://tasks.googleapis.com/tasks/v1";

const toTask = (t: any): Task => ({
  id: String(t.id),
  title: String(t.title ?? ""),
  ...(t.notes ? { notes: String(t.notes) } : {}),
  ...(t.due ? { due: String(t.due).slice(0, 10) } : {}),
  status: t.status === "completed" ? "completed" : "needsAction",
  ...(t.parent ? { parent: String(t.parent) } : {}),
});
const dueOf = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new GoogleError("due must be YYYY-MM-DD");
  return `${d}T00:00:00.000Z`; // Google Tasks keeps the date only
};

/** Google Tasks REST API with a refresh token. Access tokens are cached until a minute before they expire. */
export class GoogleTasks implements TaskProvider {
  private auth: GoogleToken;
  constructor(o: { clientId: string; clientSecret: string; refreshToken?: string }, f: typeof fetch, now: () => number = () => Date.now()) {
    this.auth = new GoogleToken(o, f, now);
  }

  private api(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<any> {
    const u = new URL(`${TASKS}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
    return this.auth.api(u, { method, body });
  }

  async lists(): Promise<TaskList[]> {
    return ((await this.api("GET", "/users/@me/lists", undefined, { maxResults: "100" })).items ?? []).map((l: any) => ({ id: String(l.id), title: String(l.title ?? "") }));
  }
  private async listId(list: string) {
    if (!list) return "@default";
    const all = await this.lists();
    const hit = all.find((l) => l.id === list || l.title === list);
    if (!hit) throw new GoogleError(`no task list "${list}" — lists: ${all.map((l) => l.title).join(", ")}`);
    return encodeURIComponent(hit.id);
  }
  async list(list: string, o: { showCompleted: boolean; limit: number }) {
    const id = await this.listId(list);
    const items = (await this.api("GET", `/lists/${id}/tasks`, undefined, { maxResults: String(Math.min(Math.max(o.limit, 1), 100)), showCompleted: String(o.showCompleted), showHidden: String(o.showCompleted) })).items ?? [];
    return (items as any[]).map(toTask);
  }
  async add(list: string, t: { title: string; notes?: string; due?: string }) {
    const body: Record<string, string> = { title: t.title.slice(0, 1024) };
    if (t.notes) body.notes = t.notes.slice(0, 8192);
    if (t.due) body.due = dueOf(t.due);
    return toTask(await this.api("POST", `/lists/${await this.listId(list)}/tasks`, body));
  }
  async update(list: string, id: string, p: { title?: string; notes?: string; due?: string | null }) {
    const body: Record<string, string | null> = {};
    if (p.title) body.title = p.title.slice(0, 1024);
    if (p.notes) body.notes = p.notes.slice(0, 8192);
    if (p.due !== undefined) body.due = p.due === null ? null : dueOf(p.due);
    if (!Object.keys(body).length) throw new GoogleError("nothing to change");
    return toTask(await this.api("PATCH", `/lists/${await this.listId(list)}/tasks/${encodeURIComponent(id)}`, body));
  }
  async complete(list: string, id: string, undo: boolean) {
    const body = undo ? { status: "needsAction", completed: null } : { status: "completed" };
    return toTask(await this.api("PATCH", `/lists/${await this.listId(list)}/tasks/${encodeURIComponent(id)}`, body));
  }
  async remove(list: string, id: string) {
    await this.api("DELETE", `/lists/${await this.listId(list)}/tasks/${encodeURIComponent(id)}`);
  }
}

export const googleTasksProvider = defineProvider({
  kind: "tasks",
  id: "google",
  title: T("Google Tasks", "Google Tasks"),
  config: z.object({
    clientId: z.string().min(10).max(200).describe("OAuth client ID (Google Cloud → APIs & Services → Credentials, type Web application)"),
    email: z.string().max(200).optional().describe("@internal"), // set by the sign-in callback
  }),
  secrets: z.object({
    clientSecret: z.string().min(1).describe("OAuth client secret"),
    refreshToken: z.string().optional().describe("@internal"), // set by the sign-in callback
  }),
  runtimes: ["node", "workers"],
  hosts: () => [...GOOGLE.hosts, "tasks.googleapis.com"],
  create: ({ config, secrets, fetch }) => new GoogleTasks({ clientId: config.clientId, clientSecret: secrets.clientSecret, refreshToken: secrets.refreshToken }, fetch),
  test: async (g) => {
    await (g as GoogleTasks).lists();
  },
});

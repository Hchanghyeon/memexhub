import type { SafeVault } from "../../storage/safe-vault.js";
import { StorageError } from "../../storage/types.js";
import type { Layout } from "./layout.js";
import { parseFrontmatter } from "./parse.js";
import { LinkGraph } from "./graph.js";

export const today = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** File-name safe title: removes characters that break wikilinks or sync. */
export const safeTitle = (t: string) =>
  t.replace(/[\[\]#^|:?*"<>\\/\n\r\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

const oneLine = (s: string, max: number) => s.replace(/[\r\n]+/g, " ").trim().slice(0, max);
const yamlStr = (s: string) => JSON.stringify(s); // JSON string is valid YAML

/** Store an original unchanged. Frontmatter is added (or missing keys merged into existing frontmatter). */
export async function saveSource(vault: SafeVault, layout: Layout, a: { title: string; content: string; url?: string; date: string }) {
  const title = safeTitle(a.title);
  if (!title) throw new StorageError("invalid", "title is empty");
  const path = `${layout.sources}/${a.date} ${title}.md`;
  const add: Record<string, string> = { title: yamlStr(a.title.trim()), created: a.date, type: "source" };
  if (a.url) {
    try {
      const u = new URL(a.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      add.source = yamlStr(u.toString());
    } catch {
      throw new StorageError("invalid", "url must be http(s)");
    }
  }
  const fm = parseFrontmatter(a.content);
  let text: string;
  if (fm.present) {
    const lines = a.content.split("\n");
    const end = lines.indexOf("---", 1);
    const extra = Object.entries(add).filter(([k]) => !(k in fm.data)).map(([k, v]) => `${k}: ${v}`);
    text = [...lines.slice(0, end), ...extra, ...lines.slice(end)].join("\n");
  } else {
    text = `---\n${Object.entries(add).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${a.content}`;
  }
  await vault.write(path, text, { overwrite: false });
  return path;
}

export async function appendLog(vault: SafeVault, layout: Layout, entry: string, date: string) {
  const log = layout.roles.log!;
  const line = `- ${date} ${oneLine(entry, 500)}`;
  const exists = await vault.stat(log);
  if (!exists) await vault.write(log, `# Log\n\n${line}\n`);
  else await vault.append(log, line + "\n");
  return { log, line };
}

/** Add `- [[page]] — description` to the page's index note; insert under `## section` if given. */
export async function addToIndex(vault: SafeVault, layout: Layout, a: { path: string; description: string; section?: string }) {
  const page = (await vault.stat(a.path)) ? a.path : undefined;
  if (!page) throw new StorageError("not_found", `"${a.path}" not found`);
  const ix = layout.indexFor(page);
  if (!ix) throw new StorageError("invalid", "indexes are off for this vault or this folder has no index note");
  if (ix === page) throw new StorageError("invalid", "a note cannot index itself");
  const name = page.split("/").pop()!.replace(/\.md$/, "");
  const line = `- [[${name}]] — ${oneLine(a.description, 80)}`;
  const g = await LinkGraph.build(vault);
  const index = g.notes.get(ix);
  if (index?.links.some((l) => g.resolve(l.target, ix) === page)) return { index: ix, added: false };
  let text = index?.text ?? `# ${ix.split("/").slice(-2, -1)[0] ?? "Index"}\n`;
  const lines = text.replace(/\n+$/, "").split("\n");
  const section = a.section ? oneLine(a.section, 60) : undefined;
  if (section) {
    const h = lines.findIndex((l) => l.trim() === `## ${section}`);
    if (h >= 0) {
      let end = h + 1;
      while (end < lines.length && !/^#{1,6}\s/.test(lines[end]!)) end++;
      while (end > h + 1 && lines[end - 1]!.trim() === "") end--;
      lines.splice(end, 0, line);
    } else lines.push("", `## ${section}`, "", line);
  } else lines.push(line);
  text = lines.join("\n") + "\n";
  await vault.write(ix, text);
  return { index: ix, added: true };
}

export async function backlinks(vault: SafeVault, path: string) {
  const g = await LinkGraph.build(vault);
  const target = g.notes.has(path) ? path : g.resolve(path, "");
  if (!target) throw new StorageError("not_found", `"${path}" not found`);
  return (g.incoming.get(target) ?? []).map((b) => ({ ...b, text: g.notes.get(b.from)!.text.split("\n")[b.line - 1]?.trim().slice(0, 200) ?? "" }));
}

/** Wiki pages Claude has not cited yet: sources that no wiki page links to (the "what to ingest" list). */
export async function pendingSources(vault: SafeVault, layout: Layout) {
  if (!layout.sources) return [];
  const g = await LinkGraph.build(vault);
  return [...g.notes.keys()]
    .filter((p) => layout.isSource(p) && !(g.incoming.get(p) ?? []).some((x) => layout.isWikiPage(x.from)))
    .sort();
}

/** A short record of what a conversation decided, saved as a source so the wiki can take it in later. */
export function conversationNote(a: { decisions: string[]; facts: string[]; todos: string[]; context?: string }, lang: "ko" | "en") {
  const h = lang === "ko" ? { d: "결정", f: "새로 안 것", t: "남은 일", c: "맥락" } : { d: "Decisions", f: "Facts", t: "To-dos", c: "Context" };
  const list = (xs: string[], todo = false) => xs.map((x) => `- ${todo ? "[ ] " : ""}${oneLine(x, 400)}`).join("\n");
  return [
    ...(a.context ? [`> ${h.c}: ${oneLine(a.context, 400)}`, ""] : []),
    ...(a.decisions.length ? [`## ${h.d}`, list(a.decisions), ""] : []),
    ...(a.facts.length ? [`## ${h.f}`, list(a.facts), ""] : []),
    ...(a.todos.length ? [`## ${h.t}`, list(a.todos, true), ""] : []),
  ].join("\n").trimEnd() + "\n";
}

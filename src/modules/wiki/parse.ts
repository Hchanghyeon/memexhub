/** Small, dependency-free parsers for Obsidian notes. */

export type FmValue = string | string[];

export interface ParsedNote {
  frontmatter: Record<string, FmValue>;
  hasFrontmatter: boolean;
  links: { target: string; line: number; embed: boolean }[];
  tags: string[];
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/** YAML subset: `key: value`, `key: [a, b]`, and block lists (`key:` then `  - item`). */
export function parseFrontmatter(text: string): { data: Record<string, FmValue>; bodyStart: number; present: boolean } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { data: {}, bodyStart: 0, present: false };
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end < 0) return { data: {}, bodyStart: 0, present: false };
  const data: Record<string, FmValue> = {};
  let listKey: string | null = null;
  for (const raw of lines.slice(1, end)) {
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const kv = raw.match(/^([A-Za-z0-9_\-가-힣]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv as unknown as [string, string, string];
    if (val === "") {
      data[key] = [];
      listKey = key;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val.slice(1, -1).split(",").map(unquote).filter((x) => x !== "");
      listKey = null;
    } else {
      data[key] = unquote(val);
      listKey = null;
    }
  }
  return { data, bodyStart: end + 1, present: true };
}

const LINK = /(!?)\[\[([^\]|#^\n]*)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const TAG = /(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

export function parseNote(text: string): ParsedNote {
  const fm = parseFrontmatter(text);
  const lines = text.split(/\r?\n/);
  const links: ParsedNote["links"] = [];
  const tags = new Set<string>();
  const fmTags = fm.data.tags;
  for (const t of Array.isArray(fmTags) ? fmTags : fmTags ? [fmTags] : []) if (t) tags.add(t.replace(/^#/, ""));
  // Links inside frontmatter values (e.g. sources: ["[[x]]"]) count too.
  for (let i = 1; i < fm.bodyStart - 1; i++) for (const m of lines[i]!.matchAll(LINK)) if (m[2]!.trim()) links.push({ target: m[2]!.trim(), line: i + 1, embed: m[1] === "!" });
  let fence = false;
  for (let i = fm.bodyStart; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const code = line.replace(/`[^`]*`/g, "");
    for (const m of code.matchAll(LINK)) if (m[2]!.trim()) links.push({ target: m[2]!.trim(), line: i + 1, embed: m[1] === "!" });
    if (!/^#{1,6}\s/.test(code)) for (const m of code.matchAll(TAG)) if (!/^\d+$/.test(m[1]!)) tags.add(m[1]!);
  }
  return { frontmatter: fm.data, hasFrontmatter: fm.present, links, tags: [...tags] };
}

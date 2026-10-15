/**
 * Markdown ↔ Notion blocks, built to round-trip exactly.
 * Only line shapes that come back identical become typed blocks (headings, "- " bullets, "- [ ]" to-dos,
 * "> " quotes, "---" dividers, fenced code, the frontmatter). Every other line — bold, numbered lists,
 * indented text, tables — is kept as a paragraph with its literal characters, so nothing is lost.
 */
export type Block = Record<string, any>;
const MAX = 1900; // Notion allows 2000 characters per text object

const rich = (s: string) => {
  const parts: Block[] = [];
  for (let i = 0; i < s.length; i += MAX) parts.push({ type: "text", text: { content: s.slice(i, i + MAX) } });
  return parts;
};
const plain = (rt: Block[] | undefined) => (rt ?? []).map((r) => r.plain_text ?? r.text?.content ?? "").join("");
const LANGS = new Set(["bash", "c", "c++", "css", "diff", "docker", "go", "html", "java", "javascript", "json", "kotlin", "markdown", "python", "ruby", "rust", "shell", "sql", "swift", "typescript", "yaml"]);

export function markdownToBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const out: Block[] = [];
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      out.push({ type: "code", code: { language: "yaml", rich_text: rich(lines.slice(1, end).join("\n")), caption: rich("frontmatter") } });
      i = end + 1;
    }
  }
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const fence = l.match(/^```(.*)$/);
    if (fence) {
      const end = lines.findIndex((x, k) => k > i && x === "```");
      if (end > 0) {
        const info = fence[1]!;
        out.push({ type: "code", code: { language: LANGS.has(info.toLowerCase()) ? info.toLowerCase() : "plain text", rich_text: rich(lines.slice(i + 1, end).join("\n")), caption: rich(`fence:${info}`) } });
        i = end;
        continue;
      }
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,3}) (.*)$/)) && m[2]!.length) out.push({ type: `heading_${m[1]!.length}`, [`heading_${m[1]!.length}`]: { rich_text: rich(m[2]!) } });
    else if ((m = l.match(/^- \[( |x)\] (.*)$/))) out.push({ type: "to_do", to_do: { rich_text: rich(m[2]!), checked: m[1] === "x" } });
    else if ((m = l.match(/^- (.+)$/)) && !/^\[[ x]\] /.test(m[1]!)) out.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(m[1]!) } });
    else if ((m = l.match(/^> (.*)$/))) out.push({ type: "quote", quote: { rich_text: rich(m[1]!) } });
    else if (l === "---") out.push({ type: "divider", divider: {} });
    else out.push({ type: "paragraph", paragraph: { rich_text: rich(l) } });
  }
  return out;
}

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  for (const [k, b] of blocks.entries()) {
    const t = b.type as string;
    const v = b[t] ?? {};
    const text = plain(v.rich_text);
    const caption = plain(v.caption);
    if (t === "code" && k === 0 && caption === "frontmatter") out.push("---", ...(text ? text.split("\n") : []), "---");
    else if (t === "code") out.push("```" + (caption.startsWith("fence:") ? caption.slice(6) : v.language === "plain text" ? "" : (v.language ?? "")), ...(text ? text.split("\n") : []), "```");
    else if (t.startsWith("heading_")) out.push(`${"#".repeat(Number(t.slice(8)))} ${text}`);
    else if (t === "to_do") out.push(`- [${v.checked ? "x" : " "}] ${text}`);
    else if (t === "bulleted_list_item") out.push(`- ${text}`);
    else if (t === "numbered_list_item") out.push(`1. ${text}`);
    else if (t === "quote") out.push(`> ${text}`);
    else if (t === "divider") out.push("---");
    else out.push(text); // paragraph and anything written in Notion we don't map: its text
  }
  return out.join("\n");
}

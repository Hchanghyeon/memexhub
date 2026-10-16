/** Obsidian syntax → plain Markdown for the viewer (no React here, so it is unit-tested). */
const CALLOUT: Record<string, string> = { note: "📝", info: "ℹ️", tip: "💡", success: "✅", warning: "⚠️", danger: "⛔", bug: "🐞", example: "📎", quote: "💬", question: "❓", abstract: "📋", todo: "☑️" };
export const WIKILINK = "#wikilink=";
export const EMBED = "#embed=";

export function prepare(src: string): { meta: [string, string][]; body: string } {
  let text = src.replace(/\r\n?/g, "\n");
  let meta: [string, string][] = [];
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    meta = fm[1]!.split("\n").flatMap((l) => {
      const m = l.match(/^([\w가-힣-]+):\s*(.*)$/);
      return m && m[2] ? [[m[1]!, m[2]!.replace(/^\[(.*)\]$/, "$1")] as [string, string]] : [];
    });
    text = text.slice(fm[0].length);
  }
  // Leave fenced code alone; rewrite the rest.
  const parts = text.split(/(^```[\s\S]*?^```)/m);
  const body = parts
    .map((part, i) =>
      i % 2
        ? part
        : part
            // ![[file|300]] → an image whose address names the vault file; the viewer decides how to show it.
            .replace(/!\[\[([^\]]+)\]\]/g, (_, t: string) => {
              const target = t.split("|")[0]!.split("#")[0]!.trim();
              return `![${target.replace(/[[\]*_]/g, "")}](${EMBED}${encodeURIComponent(target)})`;
            })
            .replace(/\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target: string, heading: string | undefined, label: string | undefined) => {
              const shown = (label ?? `${target}${heading ?? ""}`).replace(/[[\]]/g, "") || target;
              return `[${shown}](${WIKILINK}${encodeURIComponent(target)})`;
            })
            .replace(/^(>\s*)\[!(\w+)\][+-]?\s*(.*)$/gm, (_, q: string, type: string, title: string) => `${q}**${CALLOUT[type.toLowerCase()] ?? "📌"} ${title || type}**\\`),
    )
    .join("");
  return { meta, body };
}


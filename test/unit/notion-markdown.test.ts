import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks } from "../../src/providers/notion/markdown.js";

const NOTE = `---
title: Sample
tags: [주제/샘플]
---

# Heading
## Sub **bold** and [[링크]]
### Third

Paragraph with *emphasis*, \`code\` and a [link](https://example.com).
  indented line
- bullet
- [ ] open task
- [x] done task
* star bullet stays literal
1. numbered stays literal
2. second
> quote line
>no space quote stays literal
---
| a | b |
|---|---|
\`\`\`ts
const x = 1;

console.log(x);
\`\`\`
\`\`\`weird-lang
raw
\`\`\`
#not a heading
##
${"long ".repeat(800)}
`;

describe("markdown ↔ Notion blocks", () => {
  it("round-trips exactly", () => {
    expect(blocksToMarkdown(markdownToBlocks(NOTE))).toBe(NOTE);
  });
  it("maps the shapes that are safe to map", () => {
    const types = markdownToBlocks(NOTE).map((b) => b.type);
    expect(types[0]).toBe("code"); // frontmatter
    expect(types).toContain("heading_1");
    expect(types).toContain("to_do");
    expect(types).toContain("bulleted_list_item");
    expect(types).toContain("quote");
    expect(types).toContain("divider");
    expect(types.filter((t) => t === "code").length).toBe(3);
  });
  it("splits long lines across text objects", () => {
    const long = markdownToBlocks(NOTE).find((b) => b.type === "paragraph" && b.paragraph.rich_text.length > 1);
    expect(long!.paragraph.rich_text.every((r: any) => r.text.content.length <= 1900)).toBe(true);
  });
  it("reads blocks written in Notion by people too", () => {
    expect(blocksToMarkdown([{ type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "first" }] } }, { type: "callout", callout: { rich_text: [{ plain_text: "note" }] } }])).toBe("1. first\nnote");
  });
});

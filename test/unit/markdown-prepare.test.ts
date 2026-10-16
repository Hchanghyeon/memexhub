import { describe, expect, it } from "vitest";
import { prepare, WIKILINK } from "../../web/src/ui/markdown-prepare.js";

describe("vault viewer: Obsidian syntax", () => {
  it("splits frontmatter, rewrites wiki links, embeds and callouts, and leaves code alone", () => {
    const src = "---\ntitle: T\ntags: [a, b]\n---\n# T\nSee [[Seeds]], [[folder/Plan#Goals|the plan]] and [[#Local]].\n![[photo.png]]\n> [!warning] Careful\n> text\n```\n[[not a link]]\n```\n";
    const { meta, body } = prepare(src);
    expect(meta).toEqual([["title", "T"], ["tags", "a, b"]]);
    expect(body).toContain(`[Seeds](${WIKILINK}Seeds)`);
    expect(body).toContain(`[the plan](${WIKILINK}folder%2FPlan)`);
    expect(body).toContain(`[#Local](${WIKILINK})`);
    expect(body).toContain("*🖼 photo.png*");
    expect(body).toContain("> **⚠️ Careful**\\\n> text");
    expect(body).toContain("```\n[[not a link]]\n```");
    expect(body.startsWith("# T")).toBe(true);
  });
});

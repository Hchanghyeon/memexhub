import { describe, expect, it } from "vitest";
import { CALLOUT_MARK, EMBED, HIGHLIGHT, prepare, WIKILINK } from "../../web/src/ui/markdown-prepare.js";

describe("vault viewer: Obsidian syntax", () => {
  it("splits frontmatter, rewrites wiki links, embeds and callouts, and leaves code alone", () => {
    const src = "---\ntitle: T\ntags: [a, b]\n---\n# T\nSee [[Seeds]], [[folder/Plan#Goals|the plan]] and [[#Local]].\n![[photo.png]]\n> [!warning] Careful\n> text\n```\n[[not a link]]\n```\n";
    const { meta, body } = prepare(src);
    expect(meta).toEqual([["title", "T"], ["tags", "a, b"]]);
    expect(body).toContain(`[Seeds](${WIKILINK}Seeds)`);
    expect(body).toContain(`[the plan](${WIKILINK}folder%2FPlan)`);
    expect(body).toContain(`[#Local](${WIKILINK})`);
    expect(body).toContain(`![photo.png](${EMBED}photo.png)`);
    expect(body).toContain(`> [⚠️ Careful](${CALLOUT_MARK}warning:)\n>\n> text`);
    expect(body).toContain("```\n[[not a link]]\n```");
    expect(body.startsWith("# T")).toBe(true);
  });

  it("keeps embed targets but drops size and heading parts", () => {
    const { body } = prepare("![[files/scan 1.pdf]] ![[pic.png|300]] ![[Note#Part]]");
    expect(body).toContain(`![files/scan 1.pdf](${EMBED}files%2Fscan%201.pdf)`);
    expect(body).toContain(`![pic.png](${EMBED}pic.png)`);
    expect(body).toContain(`![Note](${EMBED}Note)`);
  });

  it("marks folding callouts and gives the title its own paragraph", () => {
    const { body } = prepare("> [!note]- 💳 Payments\n> | a |\n>> [!tip]+ Inner\n");
    expect(body).toContain(`> [💳 Payments](${CALLOUT_MARK}note:-)\n>\n> | a |`);
    expect(body).toContain(`>> [💡 Inner](${CALLOUT_MARK}tip:+)\n>>`);
  });

  it("turns ==highlights== into marks, but not inside inline or fenced code", () => {
    const { body } = prepare("Spent ==₩137,960== today. `a==b==c`\n```\n==x==\n```\n");
    expect(body).toContain(`[₩137,960](${HIGHLIGHT})`);
    expect(body).toContain("`a==b==c`");
    expect(body).toContain("```\n==x==\n```");
  });
});

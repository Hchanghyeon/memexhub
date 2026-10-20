import { describe, expect, it } from "vitest";
import { serverInstructions } from "../../src/hub.js";

const all = () => true;

describe("core memory in the MCP instructions", () => {
  it("is left out when no note is set", () => {
    expect(serverInstructions(all).ko).not.toContain("핵심 기억");
  });
  it("carries the note's text and asks to keep it current", () => {
    const t = serverInstructions(all, { path: "me/profile.md", text: "- 백엔드 개발자\n- 이직 준비 중" });
    expect(t.ko).toContain("- 이직 준비 중");
    expect(t.ko).toContain('"me/profile.md"');
    expect(t.en).toMatch(/update that note with write_note/);
  });
  it("asks to start the note when it does not exist yet", () => {
    expect(serverInstructions(all, { path: "me/profile.md", text: "" }).en).toMatch(/no core memory note yet/);
  });
});

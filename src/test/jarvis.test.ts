import { describe, it, expect } from "vitest";
import { JARVIS_ROLES, stripMarkdownForSpeech } from "@/lib/jarvis";

describe("jarvis", () => {
  it("is limited to admins for the initial rollout", () => {
    expect([...JARVIS_ROLES]).toEqual(["admin"]);
  });

  it("strips markdown formatting for speech", () => {
    const md = "## Status\n\n**Saurabh** has *3* stale leads. See [pipeline](/pipeline).";
    expect(stripMarkdownForSpeech(md)).toBe("Status Saurabh has 3 stale leads. See pipeline.");
  });

  it("flattens tables into speakable text", () => {
    const md = "| Rep | Value |\n| --- | --- |\n| Anita | 2 lakh |";
    const out = stripMarkdownForSpeech(md);
    expect(out).not.toContain("|");
    expect(out).toContain("Anita");
    expect(out).toContain("2 lakh");
  });

  it("removes code blocks and speaks rupee symbols", () => {
    const md = "Total is ₹450000.\n```sql\nselect 1;\n```Done.";
    const out = stripMarkdownForSpeech(md);
    expect(out).toContain("rupees 450000");
    expect(out).not.toContain("select 1");
  });
});

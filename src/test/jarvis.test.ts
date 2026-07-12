import { describe, it, expect } from "vitest";
import {
  DEFAULT_JARVIS_LANGUAGE,
  JARVIS_LANGUAGES,
  JARVIS_ROLES,
  JARVIS_SUGGESTIONS,
  clampJarvisFabPosition,
  jarvisSttLang,
  stripMarkdownForSpeech,
} from "@/lib/jarvis";

describe("jarvis", () => {
  it("is available to admin, sales, service head and accounts only", () => {
    expect([...JARVIS_ROLES].sort()).toEqual(
      ["admin", "sales", "service_head", "accounts"].sort(),
    );
  });

  it("supports English, Hindi and Punjabi", () => {
    expect(JARVIS_LANGUAGES.map(l => l.id)).toEqual(["en", "hi", "pa"]);
    expect(JARVIS_LANGUAGES.map(l => l.stt)).toEqual(["en-IN", "hi-IN", "pa-IN"]);
    expect(JARVIS_LANGUAGES.some(l => l.id === DEFAULT_JARVIS_LANGUAGE)).toBe(true);
  });

  it("has suggestions for every role and language, and falls back to en-IN for unknown STT lookups", () => {
    for (const role of JARVIS_ROLES) {
      for (const l of JARVIS_LANGUAGES) {
        expect(JARVIS_SUGGESTIONS[role][l.id].length).toBeGreaterThan(0);
      }
    }
    for (const l of JARVIS_LANGUAGES) {
      expect(jarvisSttLang(l.id)).toBe(l.stt);
    }
    expect(jarvisSttLang("fr")).toBe("en-IN");
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

  it("keeps the floating button inside the viewport", () => {
    // dragged past the right/bottom edge → clamped to margin
    expect(clampJarvisFabPosition(5000, 5000, 400, 800, 56)).toEqual({ x: 400 - 56 - 8, y: 800 - 56 - 8 });
    // dragged past the top/left edge → clamped to margin
    expect(clampJarvisFabPosition(-50, -50, 400, 800, 56)).toEqual({ x: 8, y: 8 });
    // already inside → unchanged
    expect(clampJarvisFabPosition(100, 200, 400, 800, 56)).toEqual({ x: 100, y: 200 });
  });

  it("removes code blocks and speaks rupee symbols", () => {
    const md = "Total is ₹450000.\n```sql\nselect 1;\n```Done.";
    const out = stripMarkdownForSpeech(md);
    expect(out).toContain("rupees 450000");
    expect(out).not.toContain("select 1");
  });
});

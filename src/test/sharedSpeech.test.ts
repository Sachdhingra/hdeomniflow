import { describe, it, expect } from "vitest";
import {
  DEFAULT_JARVIS_LANGUAGE,
  JARVIS_LANGUAGES,
  briefingPlayedKey,
  jarvisSttLang,
  shouldPlayBriefing,
  stripMarkdownForSpeech,
} from "@/lib/jarvis";

describe("shared language and speech helpers", () => {
  it("supports English, Hindi and Punjabi", () => {
    expect(JARVIS_LANGUAGES.map(l => l.id)).toEqual(["en", "hi", "pa"]);
    expect(JARVIS_LANGUAGES.map(l => l.stt)).toEqual(["en-IN", "hi-IN", "pa-IN"]);
    expect(JARVIS_LANGUAGES.some(l => l.id === DEFAULT_JARVIS_LANGUAGE)).toBe(true);
  });

  it("maps each language to its recognition tag and falls back to en-IN", () => {
    for (const l of JARVIS_LANGUAGES) expect(jarvisSttLang(l.id)).toBe(l.stt);
    expect(jarvisSttLang("fr")).toBe("en-IN");
  });

  it("plays the daily briefing once per day per user", () => {
    expect(shouldPlayBriefing(null, "2026-07-12")).toBe(true);
    expect(shouldPlayBriefing("2026-07-11", "2026-07-12")).toBe(true);
    expect(shouldPlayBriefing("2026-07-12", "2026-07-12")).toBe(false);
    expect(briefingPlayedKey("user-1")).not.toBe(briefingPlayedKey("user-2"));
  });

  it("strips markdown formatting for speech", () => {
    const md = "## Status\n\n**Saurabh** has *3* stale leads. See [pipeline](/pipeline).";
    expect(stripMarkdownForSpeech(md)).toBe("Status Saurabh has 3 stale leads. See pipeline.");
  });

  it("flattens tables into speakable text", () => {
    const out = stripMarkdownForSpeech("| Rep | Value |\n| --- | --- |\n| Anita | 2 lakh |");
    expect(out).not.toContain("|");
    expect(out).toContain("Anita");
    expect(out).toContain("2 lakh");
  });

  it("removes code blocks and speaks rupee symbols", () => {
    const out = stripMarkdownForSpeech("Total is ₹450000.\n```sql\nselect 1;\n```Done.");
    expect(out).toContain("rupees 450000");
    expect(out).not.toContain("select 1");
  });
});

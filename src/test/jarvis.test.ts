import { describe, it, expect } from "vitest";
import {
  DEFAULT_JARVIS_LANGUAGE,
  JARVIS_LANGUAGES,
  JARVIS_ROLES,
  JARVIS_SUGGESTIONS,
  briefingPlayedKey,
  clampJarvisFabPosition,
  extractWakeCommand,
  jarvisSttLang,
  shouldPlayBriefing,
  stripMarkdownForSpeech,
} from "@/lib/jarvis";
import { updateNoiseFloor, voiceDetected } from "@/lib/speech";

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

  it("detects the wake word in English, Hindi and Punjabi", () => {
    expect(extractWakeCommand("Hey Jarvis")).toBe("");
    expect(extractWakeCommand("hey jarvis, what's my target?")).toBe("what's my target?");
    expect(extractWakeCommand("OK Jarvis how are sales")).toBe("how are sales");
    expect(extractWakeCommand("jarvis show overdue leads")).toBe("show overdue leads");
    expect(extractWakeCommand("हे जार्विस आज क्या ओवरड्यू है")).toBe("आज क्या ओवरड्यू है");
    expect(extractWakeCommand("ਹੇ ਜਾਰਵਿਸ ਅੱਜ ਕੀ ਪੈਂਡਿੰਗ ਹੈ")).toBe("ਅੱਜ ਕੀ ਪੈਂਡਿੰਗ ਹੈ");
  });

  it("ignores speech without the wake word", () => {
    expect(extractWakeCommand("what's my target this month")).toBeNull();
    expect(extractWakeCommand("hey there, how are you")).toBeNull();
    expect(extractWakeCommand("")).toBeNull();
  });

  it("detects speech onset above the ambient noise floor", () => {
    // quiet room: ambient hum is not speech
    expect(voiceDetected(0.003, 0.005)).toBe(false);
    // someone talking clearly above the floor
    expect(voiceDetected(0.1, 0.005)).toBe(true);
    // loud room: the same absolute level no longer counts as speech
    expect(voiceDetected(0.05, 0.05)).toBe(false);
    // noise floor drifts slowly and speech spikes are capped so they don't drag it up
    const drifted = updateNoiseFloor(0.005, 0.5);
    expect(drifted).toBeLessThan(0.007);
    expect(drifted).toBeGreaterThan(0.005);
  });

  it("plays the daily briefing once per day per user", () => {
    expect(shouldPlayBriefing(null, "2026-07-12")).toBe(true);
    expect(shouldPlayBriefing("2026-07-11", "2026-07-12")).toBe(true);
    expect(shouldPlayBriefing("2026-07-12", "2026-07-12")).toBe(false);
    expect(briefingPlayedKey("user-1")).not.toBe(briefingPlayedKey("user-2"));
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

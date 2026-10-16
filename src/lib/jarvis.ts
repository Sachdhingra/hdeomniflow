// Language and speech helpers shared by the staff coach, the AI assistant
// and the daily voice briefing.

export const JARVIS_LANGUAGE_STORAGE_KEY = "omniflow-jarvis-language";

// Languages the coach, assistant and briefing listen to and answer in. `stt` is the BCP-47 tag used
// for browser speech recognition and the speech-synthesis fallback; `id` is
// sent to the edge function (must stay in sync with LANGUAGE_INSTRUCTIONS in
// supabase/functions/ai-assistant).
export const JARVIS_LANGUAGES = [
  { id: "en", label: "English", stt: "en-IN" },
  { id: "hi", label: "हिंदी (Hindi)", stt: "hi-IN" },
  { id: "pa", label: "ਪੰਜਾਬੀ (Punjabi)", stt: "pa-IN" },
] as const;

export type JarvisLanguage = (typeof JARVIS_LANGUAGES)[number]["id"];
export const DEFAULT_JARVIS_LANGUAGE: JarvisLanguage = "en";

export function jarvisSttLang(language: string): string {
  return JARVIS_LANGUAGES.find(l => l.id === language)?.stt ?? "en-IN";
}

// Daily voice briefing, auto-played on the first app open of each day.
export const JARVIS_BRIEFING_OPTOUT_KEY = "omniflow-jarvis-briefing-optout";

export function briefingPlayedKey(userId: string): string {
  return `omniflow-jarvis-briefing-played-${userId}`;
}

// True when the briefing hasn't been played yet on `today` (YYYY-MM-DD).
export function shouldPlayBriefing(lastPlayed: string | null, today: string): boolean {
  return lastPlayed !== today;
}

// Converts a markdown AI reply into plain text suitable for the browser's
// speech synthesis fallback (Gemini TTS handles markdown poorly too, but the
// server already asks for plain text in voice mode — this guards the fallback
// path and any residual formatting).
export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ") // table separator rows
    .replace(/\|/g, ", ") // table cells → commas
    .replace(/[*_~#>]/g, "") // emphasis/quote markers
    .replace(/₹\s?/g, " rupees ") // symbol the TTS voices mangle
    .replace(/\s+/g, " ")
    .trim();
}

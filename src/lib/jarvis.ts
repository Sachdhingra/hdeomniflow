// Shared constants/helpers for the Jarvis voice assistant.

// Roles allowed to use Jarvis. Admin-only for the initial rollout — add
// "sales", "accounts" and "service_head" here (and in JARVIS_VOICE_ROLES in
// supabase/functions/ai-assistant) when expanding.
export const JARVIS_ROLES = ["admin"] as const;

export const JARVIS_VOICE_STORAGE_KEY = "omniflow-jarvis-voice";
export const JARVIS_HANDSFREE_STORAGE_KEY = "omniflow-jarvis-handsfree";

// Speech recognition language — Indian English handles names and
// lakh/crore phrasing best for this team.
export const JARVIS_STT_LANG = "en-IN";

export const JARVIS_SUGGESTIONS = [
  "Give me a snapshot of the business right now",
  "Which team member needs help this week?",
  "What's overdue today?",
  "How is the team pacing against target?",
];

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

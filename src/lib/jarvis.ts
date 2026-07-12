// Shared constants/helpers for the Jarvis voice assistant.

// Roles allowed to use Jarvis. Admin-only for the initial rollout — add
// "sales", "accounts" and "service_head" here (and in JARVIS_VOICE_ROLES in
// supabase/functions/ai-assistant) when expanding.
export const JARVIS_ROLES = ["admin"] as const;

export const JARVIS_VOICE_STORAGE_KEY = "omniflow-jarvis-voice";
export const JARVIS_HANDSFREE_STORAGE_KEY = "omniflow-jarvis-handsfree";
export const JARVIS_LANGUAGE_STORAGE_KEY = "omniflow-jarvis-language";

// Languages Jarvis listens to and answers in. `stt` is the BCP-47 tag used
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

export const JARVIS_SUGGESTIONS: Record<JarvisLanguage, string[]> = {
  en: [
    "Give me a snapshot of the business right now",
    "Which team member needs help this week?",
    "How are today's service jobs going?",
    "What's pending accounts approval?",
  ],
  hi: [
    "अभी बिज़नेस की स्थिति क्या है?",
    "इस हफ़्ते किस टीम मेंबर को मदद चाहिए?",
    "आज की सर्विस जॉब्स कैसी चल रही हैं?",
    "अकाउंट्स अप्रूवल में क्या पेंडिंग है?",
  ],
  pa: [
    "ਹੁਣ ਬਿਜ਼ਨਸ ਦੀ ਹਾਲਤ ਕੀ ਹੈ?",
    "ਇਸ ਹਫ਼ਤੇ ਕਿਸ ਟੀਮ ਮੈਂਬਰ ਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?",
    "ਅੱਜ ਦੀਆਂ ਸਰਵਿਸ ਜੌਬਾਂ ਕਿਵੇਂ ਚੱਲ ਰਹੀਆਂ ਹਨ?",
    "ਅਕਾਊਂਟਸ ਅਪਰੂਵਲ ਵਿੱਚ ਕੀ ਪੈਂਡਿੰਗ ਹੈ?",
  ],
};

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

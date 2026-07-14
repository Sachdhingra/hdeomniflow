// Shared constants/helpers for the Jarvis voice assistant.

// Roles allowed to use Jarvis. Each role only ever gets its own scoped data
// from the ai-assistant edge function — admins see everything, sales see only
// their own pipeline, service heads see service jobs, accounts see approvals
// and purchases. Must stay in sync with JARVIS_VOICE_ROLES in
// supabase/functions/ai-assistant.
export const JARVIS_ROLES = ["admin", "sales", "service_head", "accounts"] as const;
export type JarvisRole = (typeof JARVIS_ROLES)[number];

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

// Suggestion chips per role and language — each role only sees prompts its
// own data scope can answer.
export const JARVIS_SUGGESTIONS: Record<JarvisRole, Record<JarvisLanguage, string[]>> = {
  admin: {
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
  },
  sales: {
    en: [
      "How am I doing this month?",
      "Which leads should I prioritise today?",
      "What's my pace to target?",
      "Which of my follow-ups are overdue?",
    ],
    hi: [
      "इस महीने मेरा प्रदर्शन कैसा है?",
      "आज किन लीड्स पर ध्यान दूँ?",
      "टारगेट तक पहुँचने की मेरी रफ़्तार क्या है?",
      "मेरे कौन से फ़ॉलो-अप ओवरड्यू हैं?",
    ],
    pa: [
      "ਇਸ ਮਹੀਨੇ ਮੇਰੀ ਕਾਰਗੁਜ਼ਾਰੀ ਕਿਵੇਂ ਹੈ?",
      "ਅੱਜ ਕਿਹੜੀਆਂ ਲੀਡਾਂ 'ਤੇ ਧਿਆਨ ਦੇਵਾਂ?",
      "ਟਾਰਗਟ ਤੱਕ ਪਹੁੰਚਣ ਦੀ ਮੇਰੀ ਰਫ਼ਤਾਰ ਕੀ ਹੈ?",
      "ਮੇਰੇ ਕਿਹੜੇ ਫਾਲੋ-ਅੱਪ ਓਵਰਡਿਊ ਹਨ?",
    ],
  },
  service_head: {
    en: [
      "Plan tomorrow's dispatch schedule",
      "Which jobs are overdue or unassigned?",
      "How loaded are my field agents?",
      "How's this month's completion rate?",
    ],
    hi: [
      "कल का डिस्पैच शेड्यूल बनाओ",
      "कौन सी जॉब्स ओवरड्यू या अनअसाइन्ड हैं?",
      "फ़ील्ड एजेंट्स पर कितना लोड है?",
      "इस महीने कितनी जॉब्स पूरी हुईं?",
    ],
    pa: [
      "ਕੱਲ੍ਹ ਦਾ ਡਿਸਪੈਚ ਸ਼ਡਿਊਲ ਬਣਾਓ",
      "ਕਿਹੜੀਆਂ ਜੌਬਾਂ ਓਵਰਡਿਊ ਜਾਂ ਅਣ-ਅਸਾਈਨਡ ਹਨ?",
      "ਫੀਲਡ ਏਜੰਟਾਂ 'ਤੇ ਕਿੰਨਾ ਲੋਡ ਹੈ?",
      "ਇਸ ਮਹੀਨੇ ਕਿੰਨੀਆਂ ਜੌਬਾਂ ਪੂਰੀਆਂ ਹੋਈਆਂ?",
    ],
  },
  accounts: {
    en: [
      "What's pending approval right now?",
      "Summarise this month's purchases",
      "Which purchases aren't in Tally yet?",
      "What's the oldest pending approval?",
    ],
    hi: [
      "अभी क्या अप्रूवल पेंडिंग है?",
      "इस महीने की खरीदारी का सारांश दो",
      "कौन सी परचेज़ अभी Tally में नहीं गई?",
      "सबसे पुराना पेंडिंग अप्रूवल कौन सा है?",
    ],
    pa: [
      "ਹੁਣ ਕੀ ਅਪਰੂਵਲ ਪੈਂਡਿੰਗ ਹੈ?",
      "ਇਸ ਮਹੀਨੇ ਦੀ ਖਰੀਦ ਦਾ ਸਾਰ ਦੱਸੋ",
      "ਕਿਹੜੀਆਂ ਪਰਚੇਜ਼ ਅਜੇ Tally ਵਿੱਚ ਨਹੀਂ ਗਈਆਂ?",
      "ਸਭ ਤੋਂ ਪੁਰਾਣਾ ਪੈਂਡਿੰਗ ਅਪਰੂਵਲ ਕਿਹੜਾ ਹੈ?",
    ],
  },
};

export const JARVIS_FAB_POSITION_STORAGE_KEY = "omniflow-jarvis-fab-pos";
export const JARVIS_FAB_TAGLINE = "Happy to assist";
export const JARVIS_WAKE_STORAGE_KEY = "omniflow-jarvis-wake";

// Daily voice briefing, auto-played on the first app open of each day.
export const JARVIS_BRIEFING_OPTOUT_KEY = "omniflow-jarvis-briefing-optout";

export function briefingPlayedKey(userId: string): string {
  return `omniflow-jarvis-briefing-played-${userId}`;
}

// True when the briefing hasn't been played yet on `today` (YYYY-MM-DD).
export function shouldPlayBriefing(lastPlayed: string | null, today: string): boolean {
  return lastPlayed !== today;
}

// "Hey Jarvis" in all supported scripts, plus common recognizer misspellings.
// Optional greeting prefix ("hey"/"ok"/…) so a bare "Jarvis" also works.
// \b only understands ASCII word characters, so leading boundaries are
// matched explicitly; recognizers space-separate words, so a Latin-only
// trailing lookahead is sufficient.
const WAKE_REGEX =
  /(?:^|[\s,])(?:(?:hey|hay|ok|okay|हे|ओके|ਹੇ|ਓਕੇ)[,\s]+)?(?:jaarvis|jarvis|jarvi|जार्विस|जारविस|जार्वीस|ਜਾਰਵਿਸ|ਜਾਰਵੀਸ)(?![a-z])/i;

// Returns null when the text does not contain the wake word; otherwise the
// command spoken after it ("" when the user said only "Hey Jarvis").
export function extractWakeCommand(text: string): string | null {
  const m = WAKE_REGEX.exec(text);
  if (!m) return null;
  return text
    .slice(m.index + m[0].length)
    .replace(/^[,.!?\s]+/, "")
    .trim();
}

// Keeps the floating Jarvis button inside the visible viewport.
export function clampJarvisFabPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  buttonSize: number,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewportWidth - buttonSize - margin);
  const maxY = Math.max(margin, viewportHeight - buttonSize - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
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

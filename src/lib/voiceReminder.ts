// Shared constants/helpers for the Gemini TTS voice reminder feature.

export const VOICE_REMINDER_ROLES = ["admin", "sales", "service_head", "accounts"] as const;

// Gemini prebuilt TTS voices exposed in the UI (must stay in sync with the
// whitelist in supabase/functions/voice-reminder).
export const GEMINI_VOICES = [
  { id: "Kore", label: "Kore — firm" },
  { id: "Puck", label: "Puck — upbeat" },
  { id: "Zephyr", label: "Zephyr — bright" },
  { id: "Charon", label: "Charon — informative" },
  { id: "Fenrir", label: "Fenrir — energetic" },
  { id: "Aoede", label: "Aoede — breezy" },
] as const;

export const DEFAULT_VOICE = "Kore";
export const VOICE_STORAGE_KEY = "omniflow-voice-reminder-voice";

export const BRIEFING_LANGUAGES = [
  { id: "en", label: "English", bcp47: "en-IN" },
  { id: "hi", label: "हिन्दी (Hindi)", bcp47: "hi-IN" },
] as const;
export type BriefingLanguage = (typeof BRIEFING_LANGUAGES)[number]["id"];
export const DEFAULT_BRIEFING_LANGUAGE: BriefingLanguage = "en";
export const BRIEFING_LANGUAGE_STORAGE_KEY = "omniflow-voice-reminder-language";

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function audioBase64ToBlob(b64: string, mimeType: string): Blob {
  const buf = base64ToBytes(b64).buffer as ArrayBuffer;
  return new Blob([buf], { type: mimeType });
}

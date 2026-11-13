// ElevenLabs text-to-speech — the first-choice coach voice (see
// supabase/functions/staff-agent). The key comes from the Lovable ElevenLabs
// connector, which must be linked to the project; until it is, this returns a
// "not configured" error and callers fall through to the next voice provider.
//
// Voice order: "Vidya" (a Hindi/Hinglish assistant voice) -> if that voice can't
// be used, the previous default "George" -> if the account is out of credits,
// ElevenLabs is skipped for a while and the caller falls back to Gemini TTS and
// then the browser's own voice. eleven_multilingual_v2 covers English and Hindi.
import { classifyElevenLabsError } from "./elevenlabs-errors.ts";

const PREVIOUS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // "George"
const DEFAULT_VOICE_ID = "Cb9z94TwCr5GzieU2cs2"; // "Vidya"
const MODEL_ID = "eleven_multilingual_v2";
const MAX_CHARS = 4000;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export type ElevenLabsResult =
  | { audio: string; mimeType: string; voiceId: string; error?: never }
  | { audio?: never; mimeType?: never; voiceId?: never; error: string };

// Out of credits: don't pay a failed round-trip on every spoken reply.
const QUOTA_COOLDOWN_MS = 10 * 60_000;
let quotaExhaustedUntil = 0;

export const elevenLabsQuotaCooldown = (): boolean => Date.now() < quotaExhaustedUntil;

export const elevenLabsConfigured = (): boolean => !!Deno.env.get("ELEVENLABS_API_KEY");

type Attempt =
  | { ok: true; audio: string }
  | { ok: false; kind: "quota" | "voice" | "other"; error: string };

async function requestVoice(apiKey: string, voiceId: string, input: string): Promise<Attempt> {
  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: input,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      console.error("ElevenLabs TTS error", voiceId, resp.status, body);
      return { ok: false, kind: classifyElevenLabsError(resp.status, body), error: `ElevenLabs TTS failed (${resp.status})` };
    }
    return { ok: true, audio: bytesToBase64(new Uint8Array(await resp.arrayBuffer())) };
  } catch (e) {
    console.error("ElevenLabs TTS request failed", e);
    return { ok: false, kind: "other", error: "ElevenLabs request timed out or failed" };
  }
}

export async function synthesizeElevenLabs(text: string): Promise<ElevenLabsResult> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return { error: "ELEVENLABS_API_KEY is not set — link the ElevenLabs connector to this project" };

  const input = text.trim().slice(0, MAX_CHARS);
  if (!input) return { error: "nothing to speak" };
  if (elevenLabsQuotaCooldown()) return { error: "ElevenLabs credits are used up — using the next voice for now" };

  const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID") || DEFAULT_VOICE_ID;
  let attempt = await requestVoice(apiKey, voiceId, input);
  // The chosen voice isn't usable on this account: use the previous default.
  if (!attempt.ok && attempt.kind === "voice" && voiceId !== PREVIOUS_VOICE_ID) {
    const previous = await requestVoice(apiKey, PREVIOUS_VOICE_ID, input);
    if (previous.ok) return { audio: previous.audio, mimeType: "audio/mpeg", voiceId: PREVIOUS_VOICE_ID };
    attempt = previous;
  }
  if (attempt.ok) return { audio: attempt.audio, mimeType: "audio/mpeg", voiceId };
  if (attempt.kind === "quota") quotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
  return { error: attempt.error };
}

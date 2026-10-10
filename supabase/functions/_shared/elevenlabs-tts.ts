// ElevenLabs text-to-speech — second-choice voice after Gemini TTS (see
// supabase/functions/staff-agent). The key comes from the Lovable ElevenLabs
// connector, which must be linked to the project; until it is, this returns a
// "not configured" error and callers fall through to the browser voice.

// "George". eleven_multilingual_v2 covers English and Hindi. Override the
// voice per project with the ELEVENLABS_VOICE_ID secret.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
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
  | { audio: string; mimeType: string; error?: never }
  | { audio?: never; mimeType?: never; error: string };

export const elevenLabsConfigured = (): boolean => !!Deno.env.get("ELEVENLABS_API_KEY");

export async function synthesizeElevenLabs(text: string): Promise<ElevenLabsResult> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return { error: "ELEVENLABS_API_KEY is not set — link the ElevenLabs connector to this project" };

  const input = text.trim().slice(0, MAX_CHARS);
  if (!input) return { error: "nothing to speak" };

  const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID") || DEFAULT_VOICE_ID;
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
      console.error("ElevenLabs TTS error", resp.status, await resp.text());
      return { error: `ElevenLabs TTS failed (${resp.status})` };
    }
    return { audio: bytesToBase64(new Uint8Array(await resp.arrayBuffer())), mimeType: "audio/mpeg" };
  } catch (e) {
    console.error("ElevenLabs TTS request failed", e);
    return { error: "ElevenLabs request timed out or failed" };
  }
}

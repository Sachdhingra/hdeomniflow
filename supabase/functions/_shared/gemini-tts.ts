// Shared Gemini TTS helpers used by the voice-reminder briefing and the
// Jarvis voice assistant (ai-assistant voice mode) edge functions.

export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Aoede"];
export const DEFAULT_TTS_VOICE = "Kore";
export const TTS_MODEL = "gemini-2.5-flash-preview-tts";

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Gemini TTS returns raw 16-bit mono PCM; browsers need a WAV container.
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  const byteRate = sampleRate * 2; // mono, 16-bit
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

export type TtsResult =
  | { audio: string; mimeType: string; error?: never }
  | { audio?: never; mimeType?: never; error: string };

export async function synthesizeSpeech(
  script: string,
  voice: string,
  apiKey: string | undefined,
  readingInstruction = "Read this briefing in a clear, friendly voice:",
): Promise<TtsResult> {
  if (!apiKey) {
    return { error: "GEMINI_API_KEY is not configured in Supabase edge function secrets" };
  }

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${readingInstruction} ${script}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      },
    );
    if (!resp.ok) {
      const bodyText = await resp.text();
      console.error("Gemini TTS error", resp.status, bodyText);
      if (resp.status === 429) {
        return { error: "Gemini API quota or billing credits exhausted — top up in Google AI Studio" };
      }
      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        return { error: "Gemini API key is invalid, expired or restricted" };
      }
      return { error: `Gemini TTS request failed with status ${resp.status}` };
    }
    const data = await resp.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part) {
      console.error("Gemini TTS returned no audio part", JSON.stringify(data).slice(0, 500));
      return { error: "Gemini TTS returned no audio" };
    }
    const pcm = base64ToBytes(part.inlineData.data);
    const rateMatch = /rate=(\d+)/.exec(part.inlineData.mimeType ?? "");
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const wav = pcmToWav(pcm, sampleRate);
    return { audio: bytesToBase64(wav), mimeType: "audio/wav" };
  } catch (e) {
    console.error("Gemini TTS request failed", e);
    return { error: "Could not reach the Gemini TTS API" };
  }
}

// One voice for every spoken feature (coach, Jarvis, daily voice briefing):
// ElevenLabs first (the Vidya voice, see elevenlabs-tts.ts), then Gemini TTS, and
// if neither works the caller gets audio: null and the browser speaks instead.
// Punjabi goes the other way round (Gemini first): Vidya's model doesn't cover it.
// ElevenLabs is skipped for a few minutes once its credits run out, so a spoken
// reply isn't delayed by a call that is going to fail.
import { synthesizeElevenLabs } from "./elevenlabs-tts.ts";
import { synthesizeSpeech } from "./gemini-tts.ts";

export interface SpeakResult {
  audio: string | null;
  mimeType: string | null;
  provider: "elevenlabs" | "gemini" | null;
  ttsError: string | null;
}

// Markdown and line breaks read badly aloud.
export const plainForSpeech = (t: string) =>
  t.replace(/[*_`#>]+/g, "").replace(/\s*\n+\s*/g, " ").trim();

export async function speakWithFallbacks(
  text: string,
  o: { geminiVoice: string; geminiKey: string | undefined; geminiInstruction?: string; preferGemini?: boolean },
): Promise<SpeakResult> {
  const plain = plainForSpeech(text);
  const tryEleven = async (): Promise<{ result?: SpeakResult; error?: string }> => {
    const r = await synthesizeElevenLabs(plain);
    return r.audio
      ? { result: { audio: r.audio, mimeType: r.mimeType, provider: "elevenlabs", ttsError: null } }
      : { error: r.error };
  };
  const tryGemini = async (): Promise<{ result?: SpeakResult; error?: string }> => {
    const r = await synthesizeSpeech(plain, o.geminiVoice, o.geminiKey, o.geminiInstruction);
    return r.audio
      ? { result: { audio: r.audio, mimeType: r.mimeType, provider: "gemini", ttsError: null } }
      : { error: r.error };
  };

  const order = o.preferGemini ? [tryGemini, tryEleven] : [tryEleven, tryGemini];
  const errors: string[] = [];
  for (const attempt of order) {
    const out = await attempt();
    if (out.result) return out.result;
    errors.push(out.error ?? "failed");
  }
  const [eleven, gemini] = o.preferGemini ? [errors[1], errors[0]] : errors;

  console.error("TTS: all server voices failed", { elevenlabs: eleven, gemini });
  return { audio: null, mimeType: null, provider: null, ttsError: `elevenlabs: ${eleven}; gemini: ${gemini}` };
}

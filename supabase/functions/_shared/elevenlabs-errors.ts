// How an ElevenLabs text-to-speech failure should be handled. Pure (no Deno, no
// I/O) so it is unit-tested and shared with elevenlabs-tts.ts.
//
//   quota   the account is out of credits: stop calling ElevenLabs for a while
//           and let the caller fall back to another voice provider.
//   voice   this voice can't be used (not in the account, needs a paid plan):
//           try the previous default voice instead.
//   other   anything else (rate limit, server error): just fall through.

export type ElevenLabsErrorKind = "quota" | "voice" | "other";

export function classifyElevenLabsError(status: number, body: string): ElevenLabsErrorKind {
  const text = body.toLowerCase();
  if (text.includes("quota_exceeded") || text.includes("exceeds your quota") || text.includes("insufficient_credits")) {
    return "quota";
  }
  if (
    text.includes("voice_not_found") ||
    text.includes("paid_plan_required") ||
    text.includes("voice_not_fine_tuned") ||
    text.includes("library voice")
  ) {
    return "voice";
  }
  // No readable reason: 404 means the voice id doesn't exist for this account,
  // and a bare 402 is "payment required" — a plan problem with the voice, not credits.
  if (status === 404) return "voice";
  if (status === 402) return "voice";
  return "other";
}

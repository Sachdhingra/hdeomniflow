// Minimal Web Speech API surface — not in the default TS DOM lib. Shared by
// the Jarvis conversation hook and the app-wide wake word listener.

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

// Voice-activity detection used by the silent wake-word standby: true when
// the current mic RMS level rises above the ambient noise floor. Thresholds
// are deliberately sensitive — a false trigger only costs a short, silent
// verification pass, while a missed trigger means "Hey Jarvis" is ignored.
export function voiceDetected(rms: number, noiseFloor: number): boolean {
  return rms > Math.max(0.012, noiseFloor * 2.5);
}

// Exponential moving average keeps the noise floor tracking slow changes in
// ambient sound (fans, traffic) without chasing speech spikes.
export function updateNoiseFloor(noiseFloor: number, rms: number): number {
  return noiseFloor * 0.95 + Math.min(rms, noiseFloor * 3) * 0.05;
}

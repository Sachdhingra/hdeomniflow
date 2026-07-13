import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { JARVIS_WAKE_STORAGE_KEY, extractWakeCommand, jarvisSttLang } from "@/lib/jarvis";
import {
  getRecognitionCtor,
  updateNoiseFloor,
  voiceDetected,
  type SpeechRecognitionLike,
} from "@/lib/speech";

// Fired (same tab) whenever the wake-word setting changes so every armed
// listener — the Jarvis page and the app-wide floating button — stays in sync.
export const JARVIS_WAKE_EVENT = "omniflow-jarvis-wake-changed";

export function getWakeEnabledSetting(): boolean {
  try {
    return localStorage.getItem(JARVIS_WAKE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setWakeEnabledSetting(on: boolean) {
  try {
    localStorage.setItem(JARVIS_WAKE_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable — the event below still updates this tab
  }
  window.dispatchEvent(new CustomEvent(JARVIS_WAKE_EVENT, { detail: on }));
}

const VAD_POLL_MS = 100; // mic level check cadence in standby
const VAD_HITS_REQUIRED = 2; // consecutive loud samples before verifying
const VERIFY_WINDOW_MS = 8000; // how long recognition runs per verification
const VERIFY_COOLDOWN_MS = 800; // silence gap before standby resumes

// Background "Hey Jarvis" listener. Runs in two stages so speech recognition
// (which plays an audible chime on some platforms, notably Android) is NOT
// kept running in a restart loop:
//
//   1. SILENT STANDBY — the mic is monitored through Web Audio voice-activity
//      detection only. No recognition service, no beeps.
//   2. VERIFY — the moment someone starts talking, speech recognition runs
//      briefly to check for the wake phrase, then standby resumes.
//
// On wake, onWake receives the command spoken after the phrase ("" when the
// user said only "Hey Jarvis"). If mic permission is denied the setting is
// turned off globally so it doesn't retry forever. Browsers without Web Audio
// fall back to a slow recognition loop.
export function useWakeWord(active: boolean, language: string, onWake: (command: string) => void) {
  const [listening, setListening] = useState(false);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const stopNowRef = useRef<() => void>(() => {});

  const supported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  useEffect(() => {
    if (!active || !supported) {
      setListening(false);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let vadTimer: ReturnType<typeof setInterval> | undefined;
    let vadPaused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let rec: SpeechRecognitionLike | null = null;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;

    const stopRecognition = () => {
      clearTimeout(verifyTimer);
      if (rec) {
        rec.onresult = null;
        rec.onend = null;
        rec.onerror = null;
        rec.abort();
        rec = null;
      }
    };

    const stopNow = () => {
      cancelled = true;
      clearInterval(vadTimer);
      clearTimeout(resumeTimer);
      stopRecognition();
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      setListening(false);
    };
    stopNowRef.current = stopNow;

    const disableWake = (message: string) => {
      stopNow();
      setWakeEnabledSetting(false);
      toast.error(message);
    };

    const resumeStandby = (delay: number) => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        vadPaused = false;
      }, delay);
    };

    // Stage 2: someone is talking — run recognition briefly to check for the
    // wake phrase. This is the only point a recognition chime can occur.
    const startVerify = () => {
      if (cancelled || rec) return;
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      rec = new Ctor();
      rec.lang = jarvisSttLang(language);
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r.isFinal) continue;
          const command = extractWakeCommand(r[0].transcript);
          if (command === null) continue;
          stopNow();
          onWakeRef.current(command);
          return;
        }
      };
      rec.onerror = (e) => {
        rec = null;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          disableWake("Microphone access was blocked — 'Hey Jarvis' has been turned off.");
        }
      };
      rec.onend = () => {
        rec = null;
        clearTimeout(verifyTimer);
        if (!cancelled) resumeStandby(VERIFY_COOLDOWN_MS);
      };
      try {
        rec.start();
        verifyTimer = setTimeout(() => rec?.stop(), VERIFY_WINDOW_MS);
      } catch {
        rec = null;
        if (!cancelled) resumeStandby(VERIFY_COOLDOWN_MS);
      }
    };

    // Fallback for browsers without Web Audio: the old recognition loop, with
    // a long gap between restarts to keep any chime infrequent.
    const startRecognitionLoop = () => {
      if (cancelled) return;
      const loop = () => {
        if (cancelled || rec) return;
        startVerify();
        const prevOnEnd = rec?.onend ?? null;
        if (rec) {
          rec.onend = () => {
            prevOnEnd?.();
            if (!cancelled) resumeTimer = setTimeout(loop, 2500);
          };
        }
      };
      loop();
      setListening(true);
    };

    // Stage 1: silent standby via voice-activity detection.
    const startStandby = async () => {
      const w = window as unknown as Record<string, unknown>;
      const AudioCtxCtor = (w.AudioContext ?? w.webkitAudioContext) as (new () => AudioContext) | undefined;
      if (!navigator.mediaDevices?.getUserMedia || !AudioCtxCtor) {
        startRecognitionLoop();
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        disableWake("Microphone access was blocked — 'Hey Jarvis' has been turned off.");
        return;
      }
      if (cancelled) {
        stream?.getTracks().forEach(t => t.stop());
        stream = null;
        return;
      }
      audioCtx = new AudioCtxCtor();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      if (audioCtx.state !== "running") {
        // Autoplay policy kept the context suspended — VAD would hear nothing.
        audioCtx.close().catch(() => {});
        audioCtx = null;
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        startRecognitionLoop();
        return;
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let noiseFloor = 0.01;
      let hits = 0;

      setListening(true);
      vadTimer = setInterval(() => {
        if (cancelled || vadPaused || rec) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        if (voiceDetected(rms, noiseFloor)) {
          hits++;
          if (hits >= VAD_HITS_REQUIRED) {
            hits = 0;
            vadPaused = true;
            startVerify();
            resumeStandby(VERIFY_WINDOW_MS + VERIFY_COOLDOWN_MS);
          }
        } else {
          hits = 0;
          noiseFloor = updateNoiseFloor(noiseFloor, rms);
        }
      }, VAD_POLL_MS);
    };

    startStandby();
    return stopNow;
  }, [active, language, supported]);

  // Immediately releases the microphone (e.g. right before the conversation
  // mic opens) without waiting for the effect cleanup to run.
  const stopNow = () => stopNowRef.current();

  return { listening, supported, stopNow };
}

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

const VAD_POLL_MS = 60; // mic level check cadence in standby
const VERIFY_WINDOW_MS = 10000; // how long recognition listens per verification
const STANDBY_RESTART_DELAY_MS = 300; // gap between verify end and standby

// Background "Hey Jarvis" listener. Runs in two alternating stages so speech
// recognition (which plays an audible chime on some platforms, notably
// Android) is NOT kept in a constant restart loop:
//
//   1. SILENT STANDBY — the mic level is monitored through a Web Audio
//      analyser. No recognition service, no beeps.
//   2. VERIFY — the moment sound rises above the room's noise floor, the
//      standby mic is fully released (recognition can't share the mic on
//      some phones) and speech recognition listens for up to 10s for the
//      wake phrase, then standby resumes.
//
// On wake, onWake receives the command spoken after the phrase ("" when the
// user said only "Hey Jarvis"). A lone "Hey Jarvis" is acted on from interim
// results so the mic opens without waiting for end-of-speech silence. If mic
// permission is denied the setting turns off globally so it doesn't retry
// forever. Browsers without Web Audio fall back to a recognition loop.
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
    let rec: SpeechRecognitionLike | null = null;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let useVad = true;

    const teardownStandby = () => {
      clearInterval(vadTimer);
      vadTimer = undefined;
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
    };

    const teardownVerify = () => {
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
      clearTimeout(restartTimer);
      teardownVerify();
      teardownStandby();
      setListening(false);
    };
    stopNowRef.current = stopNow;

    const disableWake = (message: string) => {
      stopNow();
      setWakeEnabledSetting(false);
      toast.error(message);
    };

    const fire = (command: string) => {
      stopNow();
      onWakeRef.current(command);
    };

    const scheduleStandby = (delay: number) => {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!cancelled) startStandby();
      }, delay);
    };

    // Stage 2: someone is talking — the standby mic is already released, so
    // recognition has the microphone to itself while it checks for the wake
    // phrase.
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
          const command = extractWakeCommand(r[0].transcript);
          if (command === null) continue;
          if (r.isFinal) {
            fire(command);
            return;
          }
          // Lone "Hey Jarvis" heard mid-stream: open the mic right away
          // instead of waiting ~1s for the recognizer's end-of-speech.
          if (command === "") {
            fire("");
            return;
          }
        }
      };
      rec.onerror = (e) => {
        rec = null;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          disableWake("Microphone access was blocked — 'Hey Jarvis' has been turned off.");
        }
        // other errors (no-speech, audio-capture blips): onend recovers below
      };
      rec.onend = () => {
        rec = null;
        clearTimeout(verifyTimer);
        if (!cancelled) scheduleStandby(STANDBY_RESTART_DELAY_MS);
      };
      try {
        rec.start();
        verifyTimer = setTimeout(() => rec?.stop(), VERIFY_WINDOW_MS);
      } catch {
        rec = null;
        if (!cancelled) scheduleStandby(STANDBY_RESTART_DELAY_MS);
      }
    };

    // Stage 1: silent standby via voice-activity detection. Falls back to a
    // plain recognition loop when Web Audio can't run.
    const startStandby = async () => {
      if (cancelled) return;
      if (!useVad) {
        startVerify();
        setListening(true);
        return;
      }
      const w = window as unknown as Record<string, unknown>;
      const AudioCtxCtor = (w.AudioContext ?? w.webkitAudioContext) as (new () => AudioContext) | undefined;
      if (!navigator.mediaDevices?.getUserMedia || !AudioCtxCtor) {
        useVad = false;
        startVerify();
        setListening(true);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        disableWake("Microphone access was blocked — 'Hey Jarvis' has been turned off.");
        return;
      }
      if (cancelled) {
        teardownStandby();
        return;
      }
      audioCtx = new AudioCtxCtor();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      if (audioCtx.state !== "running") {
        // Autoplay policy kept the context suspended — VAD would hear
        // nothing. Fall back to the recognition loop permanently.
        teardownStandby();
        useVad = false;
        startVerify();
        setListening(true);
        return;
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let noiseFloor = 0.008;

      setListening(true);
      vadTimer = setInterval(() => {
        if (cancelled || !audioCtx) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        if (voiceDetected(rms, noiseFloor)) {
          // Release the mic first — recognition can't share it on some
          // phones — then listen for the wake phrase.
          teardownStandby();
          startVerify();
        } else {
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

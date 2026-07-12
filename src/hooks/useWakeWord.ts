import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { JARVIS_WAKE_STORAGE_KEY, extractWakeCommand, jarvisSttLang } from "@/lib/jarvis";
import { getRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";

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

// Continuous background listener for "Hey Jarvis". While `active`, watches
// final speech results for the wake phrase and calls onWake with whatever
// command followed it ("" when the user said only the wake word). Browsers
// stop continuous recognition after a few seconds of silence, so it restarts
// itself until deactivated. If mic permission is denied the setting is turned
// off globally so it doesn't retry forever.
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
    let rec: SpeechRecognitionLike | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;

    const stopNow = () => {
      cancelled = true;
      clearTimeout(restartTimer);
      if (rec) {
        rec.onresult = null;
        rec.onend = null;
        rec.onerror = null;
        rec.abort();
        rec = null;
      }
      setListening(false);
    };
    stopNowRef.current = stopNow;

    const startWake = () => {
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
        setListening(false);
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          cancelled = true;
          setWakeEnabledSetting(false);
          toast.error("Microphone access was blocked — 'Hey Jarvis' has been turned off.");
        }
        // other errors (no-speech, network blips): onend restarts below
      };
      rec.onend = () => {
        rec = null;
        setListening(false);
        if (!cancelled) restartTimer = setTimeout(startWake, 400);
      };
      try {
        rec.start();
        setListening(true);
      } catch {
        rec = null;
      }
    };

    startWake();
    return stopNow;
  }, [active, language, supported]);

  // Immediately releases the microphone (e.g. right before the conversation
  // mic opens) without waiting for the effect cleanup to run.
  const stopNow = () => stopNowRef.current();

  return { listening, supported, stopNow };
}

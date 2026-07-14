import { useState, useRef, useCallback, useEffect } from "react";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DEFAULT_VOICE, audioBase64ToBlob } from "@/lib/voiceReminder";
import {
  DEFAULT_JARVIS_LANGUAGE,
  JARVIS_HANDSFREE_STORAGE_KEY,
  JARVIS_LANGUAGE_STORAGE_KEY,
  JARVIS_LANGUAGES,
  JARVIS_VOICE_STORAGE_KEY,
  jarvisSttLang,
  stripMarkdownForSpeech,
  type JarvisLanguage,
} from "@/lib/jarvis";
import { getRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";
import {
  JARVIS_WAKE_EVENT,
  getWakeEnabledSetting,
  setWakeEnabledSetting,
  useWakeWord,
} from "@/hooks/useWakeWord";

export type JarvisStatus = "idle" | "listening" | "thinking" | "speaking";

export interface JarvisMessage {
  role: "user" | "assistant";
  content: string;
}

interface JarvisResponse {
  reply?: string;
  audio?: string | null;
  mimeType?: string | null;
  ttsError?: string | null;
  error?: string;
}

// Voice conversation loop for Jarvis: browser speech-to-text → ai-assistant
// (voice mode) → Gemini TTS playback, with browser speech synthesis as the
// audio fallback. Optional hands-free mode re-opens the mic after each reply,
// and an optional "Hey Jarvis" wake word opens the mic while idle.
export function useJarvis() {
  const [status, setStatus] = useState<JarvisStatus>("idle");
  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [transcript, setTranscript] = useState(""); // live interim text while listening
  const [voice, setVoiceState] = useState<string>(() => {
    try {
      return localStorage.getItem(JARVIS_VOICE_STORAGE_KEY) || DEFAULT_VOICE;
    } catch {
      return DEFAULT_VOICE;
    }
  });
  const [handsFree, setHandsFreeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(JARVIS_HANDSFREE_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const [language, setLanguageState] = useState<JarvisLanguage>(() => {
    try {
      const saved = localStorage.getItem(JARVIS_LANGUAGE_STORAGE_KEY);
      return JARVIS_LANGUAGES.some(l => l.id === saved) ? (saved as JarvisLanguage) : DEFAULT_JARVIS_LANGUAGE;
    } catch {
      return DEFAULT_JARVIS_LANGUAGE;
    }
  });
  // "Hey Jarvis" wake word — off by default; keeping the mic always open is
  // an explicit opt-in. The setting is shared with the app-wide listener.
  const [wakeEnabled, setWakeEnabledLocal] = useState<boolean>(getWakeEnabledSetting);

  const sttSupported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const finalTranscriptRef = useRef("");
  const messagesRef = useRef<JarvisMessage[]>([]);
  const handsFreeRef = useRef(handsFree);
  const voiceRef = useRef(voice);
  const languageRef = useRef(language);
  const askRef = useRef<(q: string) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});
  const wakeStopRef = useRef<() => void>(() => {});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Stay in sync when the setting changes elsewhere (floating button's
  // listener turning it off after a permission denial, another component).
  useEffect(() => {
    const onChange = () => setWakeEnabledLocal(getWakeEnabledSetting());
    window.addEventListener(JARVIS_WAKE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(JARVIS_WAKE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setVoice = useCallback((v: string) => {
    setVoiceState(v);
    voiceRef.current = v;
    try {
      localStorage.setItem(JARVIS_VOICE_STORAGE_KEY, v);
    } catch {
      // storage unavailable (private mode) — keep in-memory only
    }
  }, []);

  const setHandsFree = useCallback((on: boolean) => {
    setHandsFreeState(on);
    handsFreeRef.current = on;
    try {
      localStorage.setItem(JARVIS_HANDSFREE_STORAGE_KEY, on ? "on" : "off");
    } catch {
      // storage unavailable — keep in-memory only
    }
  }, []);

  const setLanguage = useCallback((lang: JarvisLanguage) => {
    setLanguageState(lang);
    languageRef.current = lang;
    try {
      localStorage.setItem(JARVIS_LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // storage unavailable — keep in-memory only
    }
  }, []);

  const setWakeEnabled = useCallback((on: boolean) => {
    setWakeEnabledLocal(on);
    setWakeEnabledSetting(on);
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setTranscript("");
  }, []);

  // Full stop: cancel listening, playback and hands-free continuation.
  // (Wake-word listening restarts on idle while the toggle is on.)
  const stop = useCallback(() => {
    stopListening();
    stopAudio();
    setStatus("idle");
  }, [stopListening, stopAudio]);

  useEffect(() => stop, [stop]);

  const onSpeechDone = useCallback(() => {
    if (handsFreeRef.current) {
      startListeningRef.current();
    } else {
      setStatus("idle");
    }
  }, []);

  const speakWithBrowser = useCallback(
    (text: string): boolean => {
      if (!("speechSynthesis" in window)) return false;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
      utterance.lang = jarvisSttLang(languageRef.current);
      utterance.onend = onSpeechDone;
      utterance.onerror = onSpeechDone;
      window.speechSynthesis.speak(utterance);
      setStatus("speaking");
      return true;
    },
    [onSpeechDone],
  );

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      stopListening();
      wakeStopRef.current();
      stopAudio();
      const next: JarvisMessage[] = [...messagesRef.current, { role: "user", content: q }];
      messagesRef.current = next;
      setMessages(next);
      setStatus("thinking");
      try {
        const { data, error } = await supabase.functions.invoke<JarvisResponse>("ai-assistant", {
          body: {
            messages: next,
            question: q,
            voice: true,
            tts_voice: voiceRef.current,
            language: languageRef.current,
          },
        });
        if (error) {
          if (error instanceof FunctionsHttpError) {
            const body = await error.context?.json().catch(() => null);
            throw new Error(body?.error ?? `Jarvis request failed (status ${error.context?.status ?? "unknown"})`);
          }
          if (error instanceof FunctionsFetchError) {
            throw new Error("Could not reach the assistant — check your connection.");
          }
          throw error;
        }
        if (data?.error) throw new Error(data.error);
        const reply = data?.reply ?? "";
        if (!reply) throw new Error("Jarvis returned no answer");
        const withReply: JarvisMessage[] = [...messagesRef.current, { role: "assistant", content: reply }];
        messagesRef.current = withReply;
        setMessages(withReply);

        if (data?.audio) {
          const blob = audioBase64ToBlob(data.audio, data.mimeType ?? "audio/wav");
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            if (urlRef.current) {
              URL.revokeObjectURL(urlRef.current);
              urlRef.current = null;
            }
            onSpeechDone();
          };
          audio.onerror = onSpeechDone;
          try {
            await audio.play();
            setStatus("speaking");
          } catch {
            // Autoplay blocked (common on mobile) — fall back to browser speech.
            if (!speakWithBrowser(reply)) setStatus("idle");
          }
        } else if (!speakWithBrowser(reply)) {
          // No Gemini audio and no browser TTS — the transcript is still shown.
          setStatus("idle");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Jarvis request failed");
        setStatus("idle");
      }
    },
    [stopListening, stopAudio, speakWithBrowser, onSpeechDone],
  );
  askRef.current = ask;

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input is not supported in this browser — type your question instead.");
      return;
    }
    stopAudio();
    stopListening();
    wakeStopRef.current();
    finalTranscriptRef.current = "";
    const rec = new Ctor();
    rec.lang = jarvisSttLang(languageRef.current);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTranscriptRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript((finalTranscriptRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      recognitionRef.current = null;
      setTranscript("");
      setStatus("idle");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Microphone access was blocked — allow it in your browser settings.");
      } else if (e.error && e.error !== "no-speech" && e.error !== "aborted") {
        toast.error(`Voice input error: ${e.error}`);
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setTranscript("");
      const heard = finalTranscriptRef.current.trim();
      if (heard) {
        askRef.current(heard);
      } else {
        setStatus("idle");
      }
    };
    recognitionRef.current = rec;
    setStatus("listening");
    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
      setStatus("idle");
      toast.error("Could not start the microphone — try again.");
    }
  }, [stopAudio, stopListening]);
  startListeningRef.current = startListening;

  // "Hey Jarvis" while idle: the wake word alone opens the mic; "Hey Jarvis,
  // <question>" asks the question directly.
  const wake = useWakeWord(
    wakeEnabled && status === "idle" && sttSupported,
    language,
    (command) => {
      if (command.length > 2) askRef.current(command);
      else startListeningRef.current();
    },
  );
  wakeStopRef.current = wake.stopNow;

  const reset = useCallback(() => {
    stop();
    messagesRef.current = [];
    setMessages([]);
  }, [stop]);

  return {
    status,
    messages,
    transcript,
    voice,
    setVoice,
    handsFree,
    setHandsFree,
    language,
    setLanguage,
    wakeEnabled,
    setWakeEnabled,
    wakeListening: wake.listening,
    sttSupported,
    startListening,
    ask,
    stop,
    reset,
  };
}

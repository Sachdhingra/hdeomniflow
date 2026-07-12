import { useState, useRef, useCallback, useEffect } from "react";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DEFAULT_VOICE, audioBase64ToBlob } from "@/lib/voiceReminder";
import {
  JARVIS_HANDSFREE_STORAGE_KEY,
  JARVIS_STT_LANG,
  JARVIS_VOICE_STORAGE_KEY,
  stripMarkdownForSpeech,
} from "@/lib/jarvis";

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

// Minimal Web Speech API surface — not in the default TS DOM lib.
interface SpeechRecognitionLike {
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

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

// Voice conversation loop for Jarvis: browser speech-to-text → ai-assistant
// (voice mode) → Gemini TTS playback, with browser speech synthesis as the
// audio fallback. Optional hands-free mode re-opens the mic after each reply.
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

  const sttSupported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const finalTranscriptRef = useRef("");
  const messagesRef = useRef<JarvisMessage[]>([]);
  const handsFreeRef = useRef(handsFree);
  const voiceRef = useRef(voice);
  const askRef = useRef<(q: string) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
      stopAudio();
      const next: JarvisMessage[] = [...messagesRef.current, { role: "user", content: q }];
      messagesRef.current = next;
      setMessages(next);
      setStatus("thinking");
      try {
        const { data, error } = await supabase.functions.invoke<JarvisResponse>("ai-assistant", {
          body: { messages: next, question: q, voice: true, tts_voice: voiceRef.current },
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
    finalTranscriptRef.current = "";
    const rec = new Ctor();
    rec.lang = JARVIS_STT_LANG;
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
    sttSupported,
    startListening,
    ask,
    stop,
    reset,
  };
}

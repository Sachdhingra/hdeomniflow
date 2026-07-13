import { useState, useRef, useCallback, useEffect } from "react";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DEFAULT_VOICE,
  VOICE_STORAGE_KEY,
  audioBase64ToBlob,
  BRIEFING_LANGUAGES,
  BRIEFING_LANGUAGE_STORAGE_KEY,
  DEFAULT_BRIEFING_LANGUAGE,
  type BriefingLanguage,
} from "@/lib/voiceReminder";

interface VoiceReminderResponse {
  script?: string | null;
  audio?: string | null;
  mimeType?: string | null;
  ttsError?: string | null;
  error?: string;
}

// Fetches a Gemini-generated voice briefing from the voice-reminder edge
// function and plays it. Falls back to the browser's speech synthesis when
// the function returns a script without audio (TTS key missing, quota
// exhausted) or when the browser blocks audio playback.
export function useVoiceReminder() {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [voice, setVoiceState] = useState<string>(() => {
    try {
      return localStorage.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE;
    } catch {
      return DEFAULT_VOICE;
    }
  });
  const [language, setLanguageState] = useState<BriefingLanguage>(() => {
    try {
      const v = localStorage.getItem(BRIEFING_LANGUAGE_STORAGE_KEY);
      if (v && BRIEFING_LANGUAGES.some(l => l.id === v)) return v as BriefingLanguage;
    } catch {
      /* ignore */
    }
    return DEFAULT_BRIEFING_LANGUAGE;
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const setVoice = useCallback((v: string) => {
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, v);
    } catch {
      // storage unavailable (private mode) — keep in-memory only
    }
  }, []);

  const setLanguage = useCallback((l: BriefingLanguage) => {
    setLanguageState(l);
    try {
      localStorage.setItem(BRIEFING_LANGUAGE_STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const speakWithBrowser = useCallback((text: string): boolean => {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const bcp = BRIEFING_LANGUAGES.find(l => l.id === language)?.bcp47 ?? "en-IN";
    utterance.lang = bcp;
    const match = window.speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith(bcp.toLowerCase().split("-")[0]));
    if (match) utterance.voice = match;
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
    setPlaying(true);
    return true;
  }, [language]);

  const play = useCallback(async () => {
    if (loading) return;
    stop();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<VoiceReminderResponse>("voice-reminder", {
        body: { voice },
      });
      if (error) {
        // Surface the real cause instead of the generic invoke message.
        if (error instanceof FunctionsHttpError) {
          const status = error.context?.status;
          if (status === 404) {
            throw new Error("The voice-reminder function is not deployed yet — deploy it in Supabase and try again.");
          }
          const body = await error.context?.json().catch(() => null);
          throw new Error(body?.error ?? `Voice briefing failed (status ${status ?? "unknown"})`);
        }
        if (error instanceof FunctionsFetchError) {
          throw new Error("Could not reach the voice-reminder function — check your connection.");
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);

      const briefing = data?.script ?? null;
      setScript(briefing);

      if (data?.audio) {
        const blob = audioBase64ToBlob(data.audio, data.mimeType ?? "audio/wav");
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setPlaying(false);
          if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
          }
        };
        audio.onerror = () => setPlaying(false);
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          // Autoplay blocked (common on mobile) — fall back to browser speech.
          if (briefing && speakWithBrowser(briefing)) {
            toast.info("Audio playback was blocked — using the browser voice instead.");
          } else {
            throw new Error("The browser blocked audio playback. Tap play again or check the transcript below.");
          }
        }
      } else if (briefing && speakWithBrowser(briefing)) {
        toast.info(
          data?.ttsError
            ? `Using browser voice — ${data.ttsError}.`
            : "Using browser voice — Gemini TTS audio unavailable.",
        );
      } else if (briefing) {
        throw new Error(
          data?.ttsError
            ? `No audio: ${data.ttsError}. Transcript is shown below.`
            : "This browser cannot play the briefing — transcript is shown below.",
        );
      } else {
        throw new Error("No briefing returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice briefing failed");
    } finally {
      setLoading(false);
    }
  }, [voice, loading, stop, speakWithBrowser]);

  return { play, stop, loading, playing, script, voice, setVoice };
}

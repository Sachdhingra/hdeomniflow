import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DEFAULT_VOICE,
  VOICE_STORAGE_KEY,
  audioBase64ToBlob,
} from "@/lib/voiceReminder";

interface VoiceReminderResponse {
  script?: string | null;
  audio?: string | null;
  mimeType?: string | null;
  error?: string;
}

// Fetches a Gemini-generated voice briefing from the voice-reminder edge
// function and plays it. Falls back to the browser's speech synthesis when
// the function returns a script without audio (e.g. TTS key not configured).
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

  const play = useCallback(async () => {
    if (loading) return;
    stop();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<VoiceReminderResponse>("voice-reminder", {
        body: { voice },
      });
      if (error) throw error;
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
        await audio.play();
        setPlaying(true);
      } else if (briefing && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(briefing);
        utterance.onend = () => setPlaying(false);
        window.speechSynthesis.speak(utterance);
        setPlaying(true);
      } else {
        throw new Error("No audio returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice briefing failed");
    } finally {
      setLoading(false);
    }
  }, [voice, loading, stop]);

  return { play, stop, loading, playing, script, voice, setVoice };
}

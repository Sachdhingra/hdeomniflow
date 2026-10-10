import { useCallback, useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
import { audioBase64ToBlob, DEFAULT_VOICE } from "@/lib/voiceReminder";
import {
  DEFAULT_JARVIS_LANGUAGE,
  JARVIS_LANGUAGE_STORAGE_KEY,
  JARVIS_LANGUAGES,
  jarvisSttLang,
  stripMarkdownForSpeech,
  type JarvisLanguage,
} from "@/lib/jarvis";
import { getRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";

export interface CoachMessage {
  id: string;
  sender: "agent" | "staff";
  kind: "checkin" | "reply" | "system";
  content: string;
  actions: { type: string; text?: string; date?: string }[] | null;
  read_at: string | null;
  created_at: string;
}

export type CoachStatus = "idle" | "listening" | "thinking" | "speaking";

const VOICE_ON_KEY = "omniflow-coach-voice";

// The messages table is newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const coachMessagesTable = () => (supabase as any).from("staff_agent_messages");

export const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

interface CoachResponse {
  reply?: string;
  quick_replies?: string[];
  audio?: string | null;
  mimeType?: string | null;
  error?: string;
  message?: string;
}

function readLanguage(): JarvisLanguage {
  try {
    const saved = localStorage.getItem(JARVIS_LANGUAGE_STORAGE_KEY);
    return JARVIS_LANGUAGES.some(l => l.id === saved) ? (saved as JarvisLanguage) : DEFAULT_JARVIS_LANGUAGE;
  } catch {
    return DEFAULT_JARVIS_LANGUAGE;
  }
}

// One conversation with the sales coach: the persisted thread (realtime),
// attendance gate, and a voice loop — browser speech-to-text in, Gemini TTS
// (browser speech as fallback) out. "Talk mode" keeps the mic re-opening after
// each spoken reply so it feels like a phone call; it only starts on an
// explicit tap and stops on the next one.
export function useStaffCoach(userId: string | undefined) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [present, setPresent] = useState<boolean | null>(null);
  const [status, setStatus] = useState<CoachStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [talkMode, setTalkMode] = useState(false);
  const [language, setLanguageState] = useState<JarvisLanguage>(readLanguage);
  const [voiceOn, setVoiceOnState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(VOICE_ON_KEY) === "on";
    } catch {
      return false;
    }
  });
  const sttSupported = typeof window !== "undefined" && getRecognitionCtor() !== null;

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const finalRef = useRef("");
  const talkRef = useRef(false);
  const voiceOnRef = useRef(voiceOn);
  const languageRef = useRef(language);
  const sendRef = useRef<(t: string, viaVoice?: boolean) => Promise<void>>(async () => {});
  const listenRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await coachMessagesTable()
      .select("id,sender,kind,content,actions,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages((data ?? []) as CoachMessage[]);
    setLoading(false);
  }, [userId]);

  const loadPresence = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("attendance")
      .select("clock_in,clock_out")
      .eq("user_id", userId)
      .eq("date", todayIST())
      .maybeSingle();
    setPresent(!!data?.clock_in && !data?.clock_out);
  }, [userId]);

  useEffect(() => {
    load();
    loadPresence();
  }, [load, loadPresence]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`staff-coach-thread-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_agent_messages", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const setLanguage = useCallback((lang: JarvisLanguage) => {
    setLanguageState(lang);
    languageRef.current = lang;
    try {
      localStorage.setItem(JARVIS_LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // storage unavailable — keep in memory
    }
  }, []);

  const setVoiceOn = useCallback((on: boolean) => {
    setVoiceOnState(on);
    voiceOnRef.current = on;
    try {
      localStorage.setItem(VOICE_ON_KEY, on ? "on" : "off");
    } catch {
      // storage unavailable — keep in memory
    }
  }, []);

  // ── playback ──────────────────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
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

  const onSpeechDone = useCallback(() => {
    if (talkRef.current) listenRef.current();
    else setStatus("idle");
  }, []);

  const speakWithBrowser = useCallback(
    (text: string): boolean => {
      if (!("speechSynthesis" in window)) return false;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
      u.lang = jarvisSttLang(languageRef.current);
      u.onend = onSpeechDone;
      u.onerror = onSpeechDone;
      window.speechSynthesis.speak(u);
      setStatus("speaking");
      return true;
    },
    [onSpeechDone],
  );

  // Plays server audio; falls back to browser speech when the browser blocks
  // autoplay or the audio is missing. Returns false if nothing could speak.
  const playReply = useCallback(
    async (text: string, audio?: string | null, mimeType?: string | null): Promise<boolean> => {
      stopAudio();
      if (audio) {
        const url = URL.createObjectURL(audioBase64ToBlob(audio, mimeType ?? "audio/wav"));
        urlRef.current = url;
        const el = new Audio(url);
        audioRef.current = el;
        el.onended = () => {
          if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
          }
          onSpeechDone();
        };
        el.onerror = onSpeechDone;
        try {
          await el.play();
          setStatus("speaking");
          return true;
        } catch {
          // autoplay blocked — fall through to browser speech
        }
      }
      return speakWithBrowser(text);
    },
    [stopAudio, speakWithBrowser, onSpeechDone],
  );

  const callCoach = useCallback(async (body: Record<string, unknown>): Promise<CoachResponse> => {
    const { data, error } = await supabase.functions.invoke<CoachResponse>("staff-agent", {
      body: { ...body, language: languageRef.current, tts_voice: DEFAULT_VOICE },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const b = await error.context?.json().catch(() => null);
        if (b?.error === "not_present") setPresent(false);
        throw new Error(b?.message ?? b?.error ?? "Could not reach your coach");
      }
      throw error;
    }
    if (data?.error) {
      if (data.error === "not_present") setPresent(false);
      throw new Error(data.message ?? data.error);
    }
    return data ?? {};
  }, []);

  // Read one of the coach's stored messages aloud (used for check-ins).
  const speakMessage = useCallback(
    async (m: CoachMessage) => {
      setStatus("thinking");
      try {
        const r = await callCoach({ action: "speak", message_id: m.id });
        if (!(await playReply(m.content, r.audio, r.mimeType))) setStatus("idle");
      } catch {
        // Server TTS unavailable — browser voice still works.
        if (!speakWithBrowser(m.content)) setStatus("idle");
      }
    },
    [callCoach, playReply, speakWithBrowser],
  );

  // ── sending ───────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string, viaVoice = false) => {
      const t = text.trim();
      if (!t) return;
      stopListening();
      stopAudio();
      setQuickReplies([]);
      setStatus("thinking");
      const wantVoice = viaVoice || voiceOnRef.current || talkRef.current;
      try {
        const r = await callCoach({ action: "chat", message: t, voice: wantVoice });
        await load();
        setQuickReplies(r.quick_replies ?? []);
        if (wantVoice && r.reply) {
          if (!(await playReply(r.reply, r.audio, r.mimeType))) setStatus("idle");
        } else {
          setStatus("idle");
        }
      } catch (e) {
        setStatus("idle");
        talkRef.current = false;
        setTalkMode(false);
        toast.error(e instanceof Error ? e.message : "Could not reach your coach");
      }
    },
    [stopListening, stopAudio, callCoach, load, playReply],
  );
  sendRef.current = send;

  // ── listening ─────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser — please type instead.");
      talkRef.current = false;
      setTalkMode(false);
      return;
    }
    stopAudio();
    stopListening();
    finalRef.current = "";
    const rec = new Ctor();
    rec.lang = jarvisSttLang(languageRef.current);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript((finalRef.current + interim).trim());
    };
    rec.onerror = e => {
      recognitionRef.current = null;
      setTranscript("");
      setStatus("idle");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        talkRef.current = false;
        setTalkMode(false);
        toast.error("Microphone access was blocked — allow it in your browser settings.");
      } else if (e.error && e.error !== "no-speech" && e.error !== "aborted") {
        toast.error(`Voice input error: ${e.error}`);
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setTranscript("");
      const heard = finalRef.current.trim();
      if (heard) sendRef.current(heard, true);
      else {
        // Silence: leave talk mode rather than looping on an open mic.
        talkRef.current = false;
        setTalkMode(false);
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
  listenRef.current = startListening;

  // Tap the mic once for a single spoken message.
  const listenOnce = useCallback(() => {
    setVoiceOn(true);
    startListening();
  }, [setVoiceOn, startListening]);

  // Talk mode: a hands-free spoken conversation until stopped.
  const startTalk = useCallback(() => {
    setVoiceOn(true);
    talkRef.current = true;
    setTalkMode(true);
    startListening();
  }, [setVoiceOn, startListening]);

  const stopVoice = useCallback(() => {
    talkRef.current = false;
    setTalkMode(false);
    stopListening();
    stopAudio();
    setStatus("idle");
  }, [stopListening, stopAudio]);

  useEffect(() => stopVoice, [stopVoice]);

  return {
    messages,
    loading,
    present,
    status,
    transcript,
    quickReplies,
    talkMode,
    language,
    setLanguage,
    voiceOn,
    setVoiceOn,
    sttSupported,
    send,
    speakMessage,
    listenOnce,
    startTalk,
    stopVoice,
    reload: load,
  };
}

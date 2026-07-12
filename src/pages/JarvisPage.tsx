import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useJarvis } from "@/hooks/useJarvis";
import {
  JARVIS_LANGUAGES,
  JARVIS_ROLES,
  JARVIS_SUGGESTIONS,
  type JarvisLanguage,
  type JarvisRole,
} from "@/lib/jarvis";
import { GEMINI_VOICES } from "@/lib/voiceReminder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Mic, Loader2, Volume2, Square, Send, RotateCcw, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";

const STATUS_LABEL: Record<string, string> = {
  idle: "Tap the mic and ask about your business",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking — tap to interrupt",
};

const JarvisPage = () => {
  const { user } = useAuth();
  const {
    status, messages, transcript, voice, setVoice,
    handsFree, setHandsFree, language, setLanguage,
    wakeEnabled, setWakeEnabled, wakeListening, sttSupported,
    startListening, ask, stop, reset,
  } = useJarvis();
  const [typed, setTyped] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, status]);

  const allowed = user && JARVIS_ROLES.includes(user.role as JarvisRole);
  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">Jarvis unavailable</h1>
        <p className="text-muted-foreground">
          Jarvis voice assistant is available to admin, sales, accounts and service head roles.
        </p>
      </div>
    );
  }

  const busy = status === "thinking";

  const onOrbClick = () => {
    if (status === "listening") stop();
    else if (status === "speaking") startListening();
    else if (status === "idle") startListening();
    // thinking: ignore taps
  };

  const sendTyped = () => {
    const q = typed.trim();
    if (!q || busy) return;
    setTyped("");
    ask(q);
  };

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-7rem)] flex flex-col bg-card border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <div className="font-semibold">Jarvis</div>
          <div className="text-xs text-muted-foreground">Voice assistant for your OmniFlow data</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Hands-free</span>
          <Switch checked={handsFree} onCheckedChange={setHandsFree} />
        </div>
        {sttSupported && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>"Hey Jarvis"</span>
            <Switch checked={wakeEnabled} onCheckedChange={setWakeEnabled} />
          </div>
        )}
        <Select
          value={language}
          onValueChange={v => setLanguage(v as JarvisLanguage)}
          disabled={status !== "idle"}
        >
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            {JARVIS_LANGUAGES.map(l => (
              <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={voice} onValueChange={setVoice} disabled={status !== "idle"}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Voice" />
          </SelectTrigger>
          <SelectContent>
            {GEMINI_VOICES.map(v => (
              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" onClick={reset} title="New conversation">
            <RotateCcw className="w-4 h-4" />
          </Button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Hi {user?.name?.split(" ")[0]} — ask me anything about your work. Try:
            </p>
            <div className="flex flex-wrap gap-2">
              {JARVIS_SUGGESTIONS[user!.role as JarvisRole][language].map(s => (
                <Button key={s} variant="outline" size="sm" onClick={() => ask(s)} disabled={busy}>
                  {s}
                </Button>
              ))}
            </div>
            {!sttSupported && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This browser has no voice input — type your question below and Jarvis will still answer aloud.
              </p>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
            </div>
            {m.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {status === "listening" && transcript && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-primary/20 text-foreground italic">
              {transcript}
            </div>
          </div>
        )}
        {status === "thinking" && (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing your data…
          </div>
        )}
      </div>

      <footer className="border-t border-border p-4 space-y-3">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onOrbClick}
            disabled={busy || (!sttSupported && status === "idle")}
            aria-label={STATUS_LABEL[status]}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-primary-foreground transition-all gradient-primary disabled:opacity-60 ${
              status === "listening"
                ? "animate-pulse ring-4 ring-primary/40 scale-110"
                : status === "speaking"
                  ? "ring-4 ring-primary/25"
                  : ""
            }`}
          >
            {status === "thinking" ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : status === "speaking" ? (
              <Volume2 className="w-7 h-7" />
            ) : status === "listening" ? (
              <Square className="w-6 h-6" />
            ) : (
              <Mic className="w-7 h-7" />
            )}
          </button>
          <span className="text-xs text-muted-foreground">
            {status === "idle" && wakeEnabled && wakeListening
              ? "Say “Hey Jarvis” — or tap the mic"
              : STATUS_LABEL[status]}
          </span>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Or type your question…"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendTyped();
              }
            }}
            disabled={busy}
          />
          <Button onClick={sendTyped} disabled={busy || !typed.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
};

export default JarvisPage;

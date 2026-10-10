import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AudioLines, Bot, Clock, Loader2, Mic, Send, Square, User as UserIcon, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JARVIS_LANGUAGES, type JarvisLanguage } from "@/lib/jarvis";
import type { CoachMessage, useStaffCoach } from "@/hooks/useStaffCoach";

type Coach = ReturnType<typeof useStaffCoach>;

// Shown under a fresh check-in before the coach has suggested its own.
const DEFAULT_CHIPS = ["Calls done ✅", "Customer visit hua", "Kuch atak gaya", "Help chahiye"];

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

const STATUS_TEXT = {
  listening: "Listening… speak now",
  thinking: "Coach is thinking…",
  speaking: "Coach is speaking…",
} as const;

interface Props {
  coach: Coach;
  variant: "page" | "popup";
  // Popup shows only the latest few messages.
  limit?: number;
}

const CoachPanel = ({ coach, variant, limit }: Props) => {
  const {
    messages, loading, present, status, transcript, quickReplies, talkMode, language, setLanguage,
    voiceOn, setVoiceOn, sttSupported, send, speakMessage, listenOnce, startTalk, stopVoice,
  } = coach;
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status !== "idle";
  const visible: CoachMessage[] = limit ? messages.slice(-limit) : messages;
  const last = messages[messages.length - 1];
  const chips = quickReplies.length > 0 ? quickReplies : last?.sender === "agent" && last.kind === "checkin" ? DEFAULT_CHIPS : [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, status, transcript]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    send(t);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-6">
            No check-ins yet. Once you clock in, your coach will message you at 11:30, 1:30, 3:30, 5:30 and 7:30.
          </p>
        )}
        {visible.map(m => (
          <div key={m.id} className={`flex gap-2 ${m.sender === "staff" ? "justify-end" : ""}`}>
            {m.sender === "agent" && (
              <div className="w-7 h-7 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.sender === "staff" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              <ReactMarkdown>{m.content}</ReactMarkdown>
              {m.actions && m.actions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground space-y-0.5">
                  {m.actions.map((a, i) => (
                    <div key={i}>
                      ✅ {a.type === "set_follow_up" ? `Follow-up set for ${a.date}` : `Note saved: ${a.text}`}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 text-[10px] opacity-70 mt-1">
                <span>
                  {m.kind === "checkin" ? "Check-in · " : ""}
                  {timeLabel(m.created_at)}
                </span>
                {m.sender === "agent" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => speakMessage(m)}
                    className="inline-flex items-center gap-1 hover:opacity-100 disabled:opacity-40"
                    aria-label="Listen to this message"
                  >
                    <Volume2 className="w-3 h-3" /> Listen
                  </button>
                )}
              </div>
            </div>
            {m.sender === "staff" && (
              <div className="w-7 h-7 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <UserIcon className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}
        {status === "listening" && transcript && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary/70 text-primary-foreground italic">
              {transcript}…
            </div>
          </div>
        )}
        {busy && (
          <div className="flex gap-2 items-center text-sm text-muted-foreground">
            {status === "listening" ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
            ) : (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            {STATUS_TEXT[status as keyof typeof STATUS_TEXT]}
            <button type="button" onClick={stopVoice} className="ml-auto inline-flex items-center gap-1 text-xs underline">
              <Square className="w-3 h-3" /> Stop
            </button>
          </div>
        )}
      </div>

      {present === false ? (
        <div className="border-t border-border p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          Clock in on the Attendance page to chat with your coach.
        </div>
      ) : (
        <div className="border-t border-border p-3 space-y-2">
          {chips.length > 0 && !busy && (
            <div className="flex flex-wrap gap-2">
              {chips.map(c => (
                <Button key={c} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => submit(c)}>
                  {c}
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2 items-end"
            onSubmit={e => {
              e.preventDefault();
              submit(input);
            }}
          >
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="What did you get done? What's blocking you?"
              rows={1}
              className="resize-none min-h-[40px]"
              disabled={busy}
            />
            {sttSupported && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={busy}
                onClick={listenOnce}
                aria-label="Speak your reply"
                title="Speak your reply"
              >
                <Mic className="w-4 h-4" />
              </Button>
            )}
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <div className="flex items-center gap-2">
            {sttSupported && (
              <Button
                type="button"
                size="sm"
                variant={talkMode ? "destructive" : "secondary"}
                className="h-8"
                onClick={talkMode ? stopVoice : startTalk}
              >
                <AudioLines className="w-4 h-4 mr-1" />
                {talkMode ? "End voice chat" : "Talk to coach"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                if (voiceOn) stopVoice();
                setVoiceOn(!voiceOn);
              }}
              aria-pressed={voiceOn}
              title="Read the coach's replies aloud"
            >
              {voiceOn ? <Volume2 className="w-4 h-4 mr-1" /> : <VolumeX className="w-4 h-4 mr-1" />}
              {voiceOn ? "Voice on" : "Voice off"}
            </Button>
            <div className="flex-1" />
            <Select value={language} onValueChange={v => setLanguage(v as JarvisLanguage)} disabled={busy}>
              <SelectTrigger className={`h-8 ${variant === "popup" ? "w-[110px]" : "w-[140px]"} text-xs`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JARVIS_LANGUAGES.map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachPanel;

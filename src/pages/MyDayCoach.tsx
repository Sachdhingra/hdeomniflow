import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Loader2, Send, User as UserIcon, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "@/lib/toast";

interface AgentMsg {
  id: string;
  sender: "agent" | "staff";
  kind: "checkin" | "reply" | "system";
  content: string;
  actions: { type: string; text?: string; date?: string }[] | null;
  created_at: string;
}

const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

// The messages table is new and not yet in the generated Supabase types.
const messagesTable = () => (supabase as any).from("staff_agent_messages");

const MyDayCoach = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [present, setPresent] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await messagesTable()
      .select("id,sender,kind,content,actions,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages((data ?? []) as AgentMsg[]);
    setLoading(false);
  }, [user]);

  const loadPresence = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("attendance")
      .select("clock_in,clock_out")
      .eq("user_id", user.id)
      .eq("date", todayIST())
      .maybeSingle();
    setPresent(!!data?.clock_in && !data?.clock_out);
  }, [user]);

  useEffect(() => {
    load();
    loadPresence();
  }, [load, loadPresence]);

  // Live check-ins from the 2-hourly tick.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`staff-agent-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_agent_messages", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  // Mark agent messages read once the page is open.
  useEffect(() => {
    if (!user || !messages.some(m => m.sender === "agent")) return;
    messagesTable()
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("sender", "agent")
      .is("read_at", null)
      .then(() => undefined);
  }, [user, messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      const { data, error } = await supabase.functions.invoke<{ error?: string; message?: string }>("staff-agent", {
        body: { action: "chat", message: text },
      });
      if (data?.error) {
        if (data.error === "not_present") setPresent(false);
        throw new Error(data.message ?? data.error);
      }
      if (error) throw error;
      await load();
    } catch (e) {
      setInput(text);
      toast.error(e instanceof Error ? e.message : "Could not reach your coach");
    } finally {
      setSending(false);
    }
  };

  if (!user || user.role !== "sales") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">My Day Coach unavailable</h1>
        <p className="text-muted-foreground">The coach is currently available for sales staff only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-7rem)] flex flex-col bg-card border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
          <Bot className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">My Day Coach</div>
          <div className="text-xs text-muted-foreground">
            Hi {user.name}! I check in every 2 hours (11 am – 8 pm). Tell me what you did — in any language.
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            No check-ins yet. Once you clock in, your coach will message you at 11:30, 1:30, 3:30, 5:30 and 7:30.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex gap-2 ${m.sender === "staff" ? "justify-end" : ""}`}>
            {m.sender === "agent" && (
              <div className="w-7 h-7 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
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
              <div className="text-[10px] opacity-60 mt-1">
                {m.kind === "checkin" ? "Check-in · " : ""}{timeLabel(m.created_at)}
              </div>
            </div>
            {m.sender === "staff" && (
              <div className="w-7 h-7 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <UserIcon className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 items-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Coach is thinking…
          </div>
        )}
      </div>

      {present === false ? (
        <div className="border-t border-border p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          Clock in on the Attendance page to chat with your coach.
        </div>
      ) : (
        <form
          className="border-t border-border p-3 flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="What did you get done? What's blocking you?"
            rows={1}
            className="resize-none"
            disabled={sending}
          />
          <Button type="submit" disabled={sending || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      )}
    </div>
  );
};

export default MyDayCoach;

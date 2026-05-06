import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, Loader2, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  admin: [
    "Give me a snapshot of the business right now",
    "Where are we leaking revenue?",
    "Which team member needs help this week?",
  ],
  sales: [
    "How am I doing this month?",
    "What should I focus on today?",
    "Which leads should I prioritize?",
    "What's my pace to target?",
  ],
  service_head: [
    "How's my team today?",
    "What's bottlenecking us?",
    "How's this month vs last month?",
    "Why do we have rescheduled deliveries?",
  ],
};

const AIAssistantPage = () => {
  const { user } = useAuth();
  const allowed = user && ["admin", "sales", "service_head"].includes(user.role);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, loading]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || loading || !user) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: next, question: q },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any)?.reply ?? "(no response)";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e: any) {
      toast.error(e?.message ?? "AI request failed");
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${e?.message ?? "Failed"}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">AI Assistant unavailable</h1>
        <p className="text-muted-foreground">AI Assistant is not available for your role.</p>
      </div>
    );
  }

  const suggestions = SUGGESTIONS_BY_ROLE[user!.role] ?? [];

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-7rem)] flex flex-col bg-card border border-border rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
          <Bot className="w-5 h-5" />
        </div>
        <div>
          <div className="font-semibold">AI Assistant</div>
          <div className="text-xs text-muted-foreground">Hi {user?.name}! Ask me about your numbers.</div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
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

        {loading && (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing your data…
          </div>
        )}
      </div>

      <footer className="p-3 border-t border-border flex gap-2">
        <Textarea
          placeholder="Ask anything about your performance…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          disabled={loading}
        />
        <Button onClick={() => send()} disabled={loading || !input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </footer>
    </div>
  );
};

export default AIAssistantPage;

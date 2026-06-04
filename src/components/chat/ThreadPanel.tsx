import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Send } from "lucide-react";
import MessageBody from "@/components/chat/MessageBody";

interface Profile { id: string; name: string; role?: string }
interface Reply {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
}

interface Props {
  parentId: string;
  channelId: string;
  currentUserId: string;
  profiles: Profile[];
  onClose: () => void;
}

const ThreadPanel = ({ parentId, channelId, currentUserId, profiles, onClose }: Props) => {
  const [parent, setParent] = useState<Reply | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: p } = await supabase
        .from("chat_messages")
        .select("id, body, sender_id, created_at")
        .eq("id", parentId)
        .maybeSingle();
      if (!cancel) setParent(p as Reply | null);
      const { data: r } = await (supabase
        .from("chat_messages") as any)
        .select("id, body, sender_id, created_at")
        .eq("parent_message_id", parentId)
        .is("deleted_at", null)
        .order("created_at");
      if (!cancel) setReplies((r ?? []) as Reply[]);
    })();
    const ch = supabase
      .channel(`thread-${parentId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `parent_message_id=eq.${parentId}` },
        (payload) => {
          const n = payload.new as Reply;
          setReplies(prev => (prev.some(x => x.id === n.id) ? prev : [...prev, n]));
        },
      )
      .subscribe();
    return () => {
      cancel = true;
      supabase.removeChannel(ch);
    };
  }, [parentId]);

  const send = async () => {
    const body = input.trim();
    if (!body) return;
    setInput("");
    const { error } = await supabase
      .from("chat_messages")
      .insert({
        channel_id: channelId,
        sender_id: currentUserId,
        body,
        parent_message_id: parentId,
      } as any);
    if (error) setInput(body);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-card border-l border-border z-40 flex flex-col shadow-xl">
      <header className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="font-semibold text-sm">Thread</div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {parent && (
          <div className="border-b border-border pb-3">
            <div className="text-xs text-muted-foreground mb-1">
              {profiles.find(p => p.id === parent.sender_id)?.name ?? "Unknown"}
            </div>
            <div className="text-sm bg-muted rounded-md px-3 py-2 break-words">
              <MessageBody body={parent.body} mine={false} profiles={profiles} currentUserId={currentUserId} />
            </div>
          </div>
        )}
        {replies.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">No replies yet</div>
        )}
        {replies.map(r => {
          const mine = r.sender_id === currentUserId;
          return (
            <div key={r.id} className={`flex ${mine ? "justify-end" : ""}`}>
              <div className="max-w-[85%]">
                <div className="text-[11px] text-muted-foreground mb-0.5">
                  {profiles.find(p => p.id === r.sender_id)?.name ?? "Unknown"} ·{" "}
                  {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className={`rounded-lg px-3 py-2 text-sm break-words ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <MessageBody body={r.body} mine={mine} profiles={profiles} currentUserId={currentUserId} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <footer className="p-2 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Reply in thread…"
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button onClick={send} size="icon" disabled={!input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </footer>
    </div>
  );
};

export default ThreadPanel;

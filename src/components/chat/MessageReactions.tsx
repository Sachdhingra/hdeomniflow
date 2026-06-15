import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🙏", "🔥", "👀", "✅"];

interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

interface Props {
  messageId: string;
  channelId: string;
  currentUserId: string;
}

const MessageReactions = ({ messageId, channelId, currentUserId }: Props) => {
  const [reactions, setReactions] = useState<Reaction[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("message_id", messageId);
      if (!cancel) setReactions((data ?? []) as Reaction[]);
    })();

    const ch = supabase
      .channel(`reactions-${messageId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions", filter: `message_id=eq.${messageId}` },
        (payload) => {
          setReactions(prev => {
            if (payload.eventType === "INSERT") {
              const n = payload.new as Reaction;
              if (prev.some(r => r.id === n.id)) return prev;
              return [...prev, n];
            }
            if (payload.eventType === "DELETE") {
              const o = payload.old as { id: string };
              return prev.filter(r => r.id !== o.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(ch);
    };
  }, [messageId]);

  const toggle = async (emoji: string) => {
    const mine = reactions.find(r => r.user_id === currentUserId && r.emoji === emoji);
    if (mine) {
      await supabase.from("message_reactions").delete().eq("id", mine.id);
    } else {
      await supabase.from("message_reactions").insert({
        message_id: messageId,
        user_id: currentUserId,
        emoji,
      });
    }
  };

  // group by emoji
  const grouped: Record<string, Reaction[]> = {};
  for (const r of reactions) {
    grouped[r.emoji] = grouped[r.emoji] || [];
    grouped[r.emoji].push(r);
  }
  const entries = Object.entries(grouped);

  return (
    <div className="flex items-center flex-wrap gap-1 mt-1">
      {entries.map(([emoji, rs]) => {
        const mine = rs.some(r => r.user_id === currentUserId);
        return (
          <button
            key={emoji}
            onClick={() => toggle(emoji)}
            className={`text-[11px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${
              mine
                ? "bg-primary/15 border-primary/40 text-foreground"
                : "bg-muted border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <span>{emoji}</span>
            <span>{rs.length}</span>
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label="Add reaction"
            className="text-muted-foreground hover:text-foreground p-0.5 rounded-full opacity-70 hover:opacity-100"
          >
            <SmilePlus className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1.5" align="start">
          <div className="flex gap-1">
            {QUICK_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => toggle(e)}
                className="text-lg p-1 hover:bg-muted rounded"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default MessageReactions;

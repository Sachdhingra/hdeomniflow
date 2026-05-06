import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Hash, Send, Plus, Search, Trash2, Edit2, Pin } from "lucide-react";
import { toast } from "sonner";

interface Channel {
  id: string;
  name: string;
  description: string | null;
  kind: "group" | "dm";
  is_default: boolean;
}
interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  file_url: string | null;
  pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

const ChatPage = () => {
  const { user, allProfiles } = useAuth();
  const allowed = user && ["admin", "sales", "accounts", "service_head"].includes(user.role);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Bootstrap: ensure default channels for this user, then load
  useEffect(() => {
    if (!allowed || !user) return;
    (async () => {
      await supabase.rpc("ensure_default_chat_channels", { _user: user.id });
      await loadChannels();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const loadChannels = async () => {
    const { data: ch } = await supabase
      .from("chat_channels")
      .select("*")
      .order("is_default", { ascending: false })
      .order("created_at");
    const list = (ch ?? []) as Channel[];
    setChannels(list);
    if (list.length) {
      const { data: m } = await supabase
        .from("chat_channel_members")
        .select("channel_id,user_id")
        .in("channel_id", list.map(c => c.id));
      const map: Record<string, string[]> = {};
      (m ?? []).forEach(r => {
        map[r.channel_id] = map[r.channel_id] || [];
        map[r.channel_id].push(r.user_id);
      });
      setMembers(map);
      if (!activeId) setActiveId(list[0].id);
    }
  };

  // Load messages + realtime per active channel
  useEffect(() => {
    if (!activeId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("channel_id", activeId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(200);
      if (!cancel) setMessages((data ?? []) as Message[]);
    })();

    const channel = supabase
      .channel(`chat-${activeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${activeId}` },
        (payload) => {
          setMessages(prev => {
            if (payload.eventType === "INSERT") {
              const n = payload.new as Message;
              if (prev.some(m => m.id === n.id)) return prev;
              return [...prev, n];
            }
            if (payload.eventType === "UPDATE") {
              return prev.map(m => (m.id === (payload.new as Message).id ? (payload.new as Message) : m));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter(m => m.id !== (payload.old as Message).id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeId]);

  const activeChannel = channels.find(c => c.id === activeId);
  const groupChannels = channels.filter(c => c.kind === "group");
  const dmChannels = channels.filter(c => c.kind === "dm");

  const dmCounterpartName = (channelId: string) => {
    const ids = (members[channelId] || []).filter(id => id !== user!.id);
    const other = allProfiles.find(p => p.id === ids[0]);
    return other?.name ?? "Direct message";
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeId || !user) return;
    const body = input.trim();
    setInput("");
    const { error } = await supabase
      .from("chat_messages")
      .insert({ channel_id: activeId, sender_id: user.id, body });
    if (error) {
      toast.error(error.message);
      setInput(body);
    }
  };

  const startDM = async (otherId: string) => {
    const { data, error } = await supabase.rpc("get_or_create_dm_channel", { _other: otherId });
    if (error) return toast.error(error.message);
    await loadChannels();
    setActiveId(data as string);
  };

  const deleteMsg = async (id: string) => {
    await supabase.from("chat_messages").delete().eq("id", id);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    await supabase
      .from("chat_messages")
      .update({ body: editBody, edited_at: new Date().toISOString() })
      .eq("id", editingId);
    setEditingId(null);
    setEditBody("");
  };
  const togglePin = async (m: Message) => {
    await supabase.from("chat_messages").update({ pinned: !m.pinned }).eq("id", m.id);
  };

  const filteredMessages = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(m => m.body.toLowerCase().includes(q));
  }, [messages, search]);

  const dmCandidates = allProfiles.filter(
    p => p.id !== user?.id && ["admin", "sales", "accounts", "service_head"].includes(p.role),
  );

  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">Chat unavailable</h1>
        <p className="text-muted-foreground">Your role does not have access to internal chat.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-3">
      {/* Sidebar */}
      <aside className="w-72 bg-card border border-border rounded-lg flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search messages"
              className="pl-8 h-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          <div>
            <div className="text-xs uppercase font-semibold text-muted-foreground px-2 mb-1">Channels</div>
            {groupChannels.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                  activeId === c.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <Hash className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>

          <div>
            <div className="text-xs uppercase font-semibold text-muted-foreground px-2 mb-1 flex items-center justify-between">
              <span>Direct messages</span>
            </div>
            {dmChannels.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                  activeId === c.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="truncate">{dmCounterpartName(c.id)}</span>
              </button>
            ))}

            <div className="text-xs uppercase font-semibold text-muted-foreground px-2 mt-3 mb-1 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Start DM
            </div>
            <div className="space-y-1">
              {dmCandidates.map(p => (
                <button
                  key={p.id}
                  onClick={() => startDM(p.id)}
                  className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-muted"
                >
                  <span className="truncate">{p.name}</span>
                  <Badge variant="outline" className="text-[10px]">{p.role}</Badge>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <section className="flex-1 bg-card border border-border rounded-lg flex flex-col overflow-hidden">
        <header className="px-4 py-3 border-b border-border flex items-center gap-2">
          {activeChannel?.kind === "dm" ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          ) : (
            <Hash className="w-4 h-4 text-muted-foreground" />
          )}
          <div className="font-semibold">
            {activeChannel?.kind === "dm" ? dmCounterpartName(activeChannel.id) : activeChannel?.name}
          </div>
          {activeChannel?.description && (
            <span className="text-xs text-muted-foreground ml-2 truncate">{activeChannel.description}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {(members[activeChannel?.id ?? ""] ?? []).length} members
          </span>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredMessages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm mt-8">No messages yet. Say hi 👋</div>
          )}
          {filteredMessages.map(m => {
            const sender = allProfiles.find(p => p.id === m.sender_id);
            const mine = m.sender_id === user!.id;
            return (
              <div key={m.id} className={`flex gap-2 ${mine ? "justify-end" : ""}`}>
                {!mine && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {(sender?.name ?? "?").charAt(0)}
                  </div>
                )}
                <div className={`max-w-[70%] ${mine ? "items-end" : ""}`}>
                  <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                    <span className="font-medium">{sender?.name ?? "Unknown"}</span>
                    <span>· {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {m.edited_at && <span className="italic">(edited)</span>}
                    {m.pinned && <Pin className="w-3 h-3 text-amber-500" />}
                  </div>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      mine ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    {editingId === m.id ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          value={editBody}
                          onChange={e => setEditBody(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && saveEdit()}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      m.body
                    )}
                  </div>
                  <div className="flex gap-2 mt-0.5">
                    <button onClick={() => togglePin(m)} className="text-[11px] text-muted-foreground hover:text-foreground">
                      {m.pinned ? "Unpin" : "Pin"}
                    </button>
                    {mine && editingId !== m.id && (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(m.id);
                            setEditBody(m.body);
                          }}
                          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => deleteMsg(m.id)}
                          className="text-[11px] text-destructive/80 hover:text-destructive inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="p-3 border-t border-border flex gap-2">
          <Input
            placeholder="Type a message…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <Button onClick={sendMessage}>
            <Send className="w-4 h-4" />
          </Button>
        </footer>
      </section>
    </div>
  );
};

export default ChatPage;

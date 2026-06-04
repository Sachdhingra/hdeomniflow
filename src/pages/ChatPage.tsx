import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Hash, Send, Plus, Search, Trash2, Edit2, Pin, ArrowLeft, Paperclip, FileText, X, Download, Loader2, Check, CheckCheck, Shield, FileDown } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useChatUnread } from "@/contexts/ChatUnreadContext";
import PresenceDot from "@/components/chat/PresenceDot";
import MessageReactions from "@/components/chat/MessageReactions";
import MessageBody from "@/components/chat/MessageBody";
import AwayStatusEditor from "@/components/chat/AwayStatusEditor";
import ThreadPanel from "@/components/chat/ThreadPanel";
import { MessageSquareReply, VolumeX } from "lucide-react";

interface Channel {
  id: string;
  name: string;
  description: string | null;
  kind: "group" | "dm";
  is_default: boolean;
}
interface ChatFile {
  path: string;
  name: string;
  size: number;
  type: string;
}
interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  file_url: string | null;
  files?: ChatFile[] | null;
  pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  parent_message_id?: string | null;
  created_at: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_EXT = ["pdf","doc","docx","xlsx","xls","txt","pptx","ppt","csv","jpg","jpeg","png","webp"];
const MANAGEMENT_ROLES = ["admin","sales","accounts","service_head"];

const EDIT_WINDOW_MS = 15 * 60 * 1000;

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};
const stampLabel = (iso: string) => {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dd}/${mm}/${yy} · ${time}`;
};

const ChatPage = () => {
  const { user, allProfiles } = useAuth();
  const isMobile = useIsMobile();
  const { channelUnread, setActiveChannel } = useChatUnread();
  const allowed = user && ["admin", "sales", "accounts", "service_head"].includes(user.role);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  // message_id -> set of user_ids who have read it (excluding the sender)
  const [reads, setReads] = useState<Record<string, Set<string>>>({});
  // typing users (uid -> last typing ts) for active channel
  const [typing, setTyping] = useState<Record<string, number>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bootstrap: ensure default channels for this user, then load
  useEffect(() => {
    if (!allowed || !user) return;
    (async () => {
      await supabase.rpc("ensure_default_chat_channels", { _user: user.id });
      await loadChannels();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Load muted users (admins maintain this in user_status)
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const { data } = await (supabase.from("user_status") as any)
        .select("user_id, is_muted")
        .eq("is_muted", true);
      if (cancel) return;
      setMutedIds(new Set(((data ?? []) as { user_id: string }[]).map(r => r.user_id)));
    };
    load();
    const ch = supabase
      .channel("user-status-mute")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_status" }, load)
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, []);


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
      if (!activeId && !isMobile) setActiveId(list[0].id);
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
      if (!cancel) setMessages((data ?? []) as unknown as Message[]);
    })();

    const channel = supabase
      .channel(`chat-${activeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `channel_id=eq.${activeId}` },
        (payload) => {
          setMessages(prev => {
            if (payload.eventType === "INSERT") {
              const n = payload.new as unknown as Message;
              if (prev.some(m => m.id === n.id)) return prev;
              return [...prev, n];
            }
            if (payload.eventType === "UPDATE") {
              const n = payload.new as unknown as Message;
              if (n.deleted_at) return prev.filter(m => m.id !== n.id);
              return prev.map(m => (m.id === n.id ? n : m));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter(m => m.id !== (payload.old as { id: string }).id);
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

  // Load + subscribe to read receipts for the active channel
  useEffect(() => {
    if (!activeId || !user) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("message_reads")
        .select("message_id, user_id")
        .eq("channel_id", activeId);
      if (cancel) return;
      const map: Record<string, Set<string>> = {};
      (data ?? []).forEach(r => {
        if (!map[r.message_id]) map[r.message_id] = new Set();
        map[r.message_id].add(r.user_id);
      });
      setReads(map);
    })();

    const ch = supabase
      .channel(`reads-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads", filter: `channel_id=eq.${activeId}` },
        (payload) => {
          const r = payload.new as { message_id: string; user_id: string };
          setReads(prev => {
            const next = { ...prev };
            const set = new Set(next[r.message_id] ?? []);
            set.add(r.user_id);
            next[r.message_id] = set;
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(ch);
    };
  }, [activeId, user?.id]);

  // Mark visible messages from others as read (debounced via messages change)
  useEffect(() => {
    if (!activeId || !user || messages.length === 0) return;
    const unread = messages
      .filter(m => m.sender_id !== user.id && !(reads[m.id]?.has(user.id)))
      .map(m => ({ message_id: m.id, user_id: user.id, channel_id: activeId }));
    if (unread.length === 0) return;
    supabase
      .from("message_reads")
      .upsert(unread, { onConflict: "message_id,user_id", ignoreDuplicates: true })
      .then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeId, user?.id]);

  // Sync active channel with ChatUnreadContext so ChatNotifier doesn't double-count
  useEffect(() => {
    setActiveChannel(activeId);
    return () => setActiveChannel(null);
  }, [activeId, setActiveChannel]);

  // Typing indicator: broadcast channel per active conversation
  useEffect(() => {
    if (!activeId || !user) return;
    setTyping({});
    const ch = supabase.channel(`typing-${activeId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (payload) => {
      const uid = (payload.payload as { user_id?: string })?.user_id;
      if (!uid || uid === user.id) return;
      setTyping(prev => ({ ...prev, [uid]: Date.now() }));
    });
    ch.subscribe();
    typingChannelRef.current = ch;

    const tick = setInterval(() => {
      setTyping(prev => {
        const now = Date.now();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (now - v < 4000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);

    return () => {
      clearInterval(tick);
      supabase.removeChannel(ch);
      typingChannelRef.current = null;
    };
  }, [activeId, user?.id]);

  const sendTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user?.id },
    });
  };

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

  const canAttach = !!user && MANAGEMENT_ROLES.includes(user.role);

  const iAmMuted = !!user && mutedIds.has(user.id);

  const sendMessage = async () => {
    if (!activeId || !user) return;
    if (iAmMuted) { toast.error("You have been muted by an admin"); return; }
    if (!input.trim() && pendingFiles.length === 0) return;
    const body = input.trim();
    const filesToUpload = pendingFiles;
    setInput("");
    setPendingFiles([]);

    let uploaded: ChatFile[] = [];
    if (filesToUpload.length > 0) {
      if (!canAttach) {
        toast.error("Your role cannot share attachments");
        return;
      }
      setUploading(true);
      try {
        for (const f of filesToUpload) {
          const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
          if (!ALLOWED_EXT.includes(ext)) throw new Error(`File type .${ext} not allowed`);
          if (f.size > MAX_FILE_SIZE) throw new Error(`${f.name} exceeds 25MB`);
          const path = `${activeId}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const { error: upErr } = await supabase.storage
            .from("chat-attachments")
            .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
          if (upErr) throw upErr;
          uploaded.push({ path, name: f.name, size: f.size, type: f.type });
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Upload failed");
        setUploading(false);
        setInput(body);
        setPendingFiles(filesToUpload);
        return;
      }
      setUploading(false);
    }

    const { error } = await supabase
      .from("chat_messages")
      .insert({ channel_id: activeId, sender_id: user.id, body, files: uploaded as any });
    if (error) {
      toast.error(error.message);
      setInput(body);
      setPendingFiles(filesToUpload);
    }
  };

  const downloadAttachment = async (f: ChatFile) => {
    const { data, error } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrl(f.path, 60, { download: f.name });
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const startDM = async (otherId: string) => {
    const { data, error } = await supabase.rpc("get_or_create_dm_channel", { _other: otherId });
    if (error) return toast.error(error.message);
    await loadChannels();
    setActiveId(data as string);
  };

  const deleteMsg = async (id: string) => {
    const { error } = await supabase
      .from("chat_messages")
      .update({ deleted_at: new Date().toISOString(), body: "" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setMessages(prev => prev.filter(m => m.id !== id));
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

  const replyCounts = useMemo(() => {
    const m: Record<string, number> = {};
    messages.forEach(x => {
      if (x.parent_message_id) m[x.parent_message_id] = (m[x.parent_message_id] ?? 0) + 1;
    });
    return m;
  }, [messages]);

  const filteredMessages = useMemo(() => {
    const top = messages.filter(m => !m.parent_message_id);
    if (!search.trim()) return top;
    const q = search.toLowerCase();
    return top.filter(m =>
      m.body.toLowerCase().includes(q) ||
      (Array.isArray(m.files) && m.files.some(f => f.name.toLowerCase().includes(q)))
    );
  }, [messages, search]);

  const dmCandidates = allProfiles.filter(
    p => p.id !== user?.id && ["admin", "sales", "accounts", "service_head"].includes(p.role),
  );

  const isAdmin = user?.role === "admin";

  const exportChannelCsv = () => {
    if (!activeChannel) return;
    const rows = [["timestamp", "sender", "role", "body", "attachments", "pinned", "edited"]];
    messages.forEach(m => {
      const s = allProfiles.find(p => p.id === m.sender_id);
      rows.push([
        new Date(m.created_at).toISOString(),
        s?.name ?? "Unknown",
        s?.role ?? "",
        (m.body ?? "").replace(/\r?\n/g, " "),
        Array.isArray(m.files) ? m.files.map(f => f.name).join("|") : "",
        m.pinned ? "yes" : "",
        m.edited_at ? "yes" : "",
      ]);
    });
    const csv = rows
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = activeChannel.kind === "dm" ? dmCounterpartName(activeChannel.id) : activeChannel.name;
    a.download = `chat-${name.replace(/[^a-z0-9]+/gi, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Channel exported");
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">Chat unavailable</h1>
        <p className="text-muted-foreground">Your role does not have access to internal chat.</p>
      </div>
    );
  }

  const toggleMute = async (targetId: string, mute: boolean, reason?: string) => {
    const { error } = await (supabase.from("user_status") as any).upsert(
      { user_id: targetId, is_muted: mute, muted_reason: mute ? (reason ?? null) : null, muted_until: null },
      { onConflict: "user_id" },
    );
    if (error) return toast.error(error.message);
    await (supabase.from("chat_moderation_log") as any).insert({
      action: mute ? "mute" : "unmute",
      target_user_id: targetId,
      channel_id: activeId,
      moderator_id: user!.id,
      reason: reason ?? null,
    });
    toast.success(mute ? "User muted" : "User unmuted");
  };

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-2 sm:gap-3">
      {/* Sidebar */}
      <aside className={`${isMobile ? (activeId ? "hidden" : "flex w-full") : "flex w-72"} bg-card border border-border rounded-lg flex-col overflow-hidden`}>
        <div className="px-2 pt-2 pb-1 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-muted-foreground px-1">My status</div>
          <AwayStatusEditor />
        </div>
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
                <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{c.name}</span>
                {channelUnread[c.id] > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[10px] bg-destructive text-destructive-foreground shrink-0">
                    {channelUnread[c.id] > 99 ? "99+" : channelUnread[c.id]}
                  </Badge>
                )}
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
                <PresenceDot
                  userId={(members[c.id] ?? []).find(id => id !== user!.id) ?? ""}
                />
                <span className="truncate flex-1">{dmCounterpartName(c.id)}</span>
                {channelUnread[c.id] > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[10px] bg-destructive text-destructive-foreground shrink-0">
                    {channelUnread[c.id] > 99 ? "99+" : channelUnread[c.id]}
                  </Badge>
                )}
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
                  <span className="flex items-center gap-2 truncate">
                    <PresenceDot userId={p.id} />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <Badge variant="outline" className="text-[10px]">{p.role}</Badge>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <section className={`${isMobile && !activeId ? "hidden" : "flex"} flex-1 bg-card border border-border rounded-lg flex-col overflow-hidden min-w-0`}>
        <header className="px-3 sm:px-4 py-3 border-b border-border flex items-center gap-2">
          {isMobile && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 -ml-1" onClick={() => setActiveId(null)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {activeChannel?.kind === "dm" ? (
            <PresenceDot
              userId={(members[activeChannel.id] ?? []).find(id => id !== user!.id) ?? ""}
            />
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
          {isAdmin && activeChannel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={exportChannelCsv}
              title="Export channel as CSV"
            >
              <FileDown className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
          )}
        </header>

        {messages.some(m => m.pinned) && (
          <div className="px-3 py-2 border-b border-border bg-amber-500/5 flex items-start gap-2 max-h-28 overflow-y-auto">
            <Pin className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Pinned ({messages.filter(m => m.pinned).length})
              </div>
              {messages
                .filter(m => m.pinned)
                .slice(0, 5)
                .map(m => {
                  const s = allProfiles.find(p => p.id === m.sender_id);
                  return (
                    <div key={m.id} className="text-xs flex items-center gap-2">
                      <span className="font-medium shrink-0">{s?.name ?? "Unknown"}:</span>
                      <span className="truncate flex-1">{m.body || "(attachment)"}</span>
                      <button
                        onClick={() => togglePin(m)}
                        className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                      >
                        Unpin
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredMessages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm mt-8">No messages yet. Say hi 👋</div>
          )}
          {filteredMessages.map((m, idx) => {
            const sender = allProfiles.find(p => p.id === m.sender_id);
            const mine = m.sender_id === user!.id;
            const prev = idx > 0 ? filteredMessages[idx - 1] : null;
            const showDateSep = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            return (
              <div key={m.id}>
                {showDateSep && (
                  <div className="flex items-center gap-3 my-3" aria-label="Date separator">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                      {dayLabel(m.created_at)}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <div className={`flex gap-2 ${mine ? "justify-end" : ""}`}>
                  {!mine && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                      {(sender?.name ?? "?").charAt(0)}
                    </div>
                  )}
                  <div className={`max-w-[70%] ${mine ? "items-end" : ""}`}>
                    <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1 flex-wrap">
                      <span className="font-medium">{sender?.name ?? "Unknown"}</span>
                      {sender?.role && <span className="text-[10px] uppercase tracking-wide opacity-70">({sender.role})</span>}
                      <span title={new Date(m.created_at).toLocaleString()}>· {stampLabel(m.created_at)}</span>
                      {m.edited_at && <span className="italic">(edited)</span>}
                      {m.pinned && <Pin className="w-3 h-3 text-amber-500" />}
                      {mine && (() => {
                        const readers = reads[m.id];
                        const recipientIds = (members[activeChannel?.id ?? ""] ?? []).filter(uid => uid !== user!.id);
                        const readCount = recipientIds.filter(uid => readers?.has(uid)).length;
                        if (recipientIds.length === 0) return null;
                        if (readCount === 0) return <Check className="w-3 h-3" aria-label="Sent" />;
                        if (readCount < recipientIds.length) return <CheckCheck className="w-3 h-3" aria-label="Delivered" />;
                        return <CheckCheck className="w-3 h-3 text-sky-500" aria-label="Read by all" />;
                      })()}
                    </div>
                    {(m.body || editingId === m.id) && (
                      <div
                        className={`rounded-lg px-3 py-2 text-sm break-words ${
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
                          <MessageBody
                            body={m.body}
                            mine={mine}
                            profiles={allProfiles}
                            currentUserId={user!.id}
                          />
                        )}
                      </div>
                    )}
                    {Array.isArray(m.files) && m.files.length > 0 && editingId !== m.id && (
                      <div className={`mt-1 flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                        {m.files.map((f, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => downloadAttachment(f)}
                            className="flex items-center gap-2 text-left bg-card border border-border rounded-md px-2.5 py-2 hover:bg-muted transition-colors max-w-full"
                          >
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate">{f.name}</div>
                              <div className="text-[10px] text-muted-foreground">{formatBytes(f.size)}</div>
                            </div>
                            <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        ))}
                      </div>
                    )}
                    <MessageReactions
                      messageId={m.id}
                      channelId={activeChannel?.id ?? ""}
                      currentUserId={user!.id}
                    />
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                      <button onClick={() => togglePin(m)} className="text-[11px] text-muted-foreground hover:text-foreground">
                        {m.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        onClick={() => setThreadParentId(m.id)}
                        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <MessageSquareReply className="w-3 h-3" />
                        {replyCounts[m.id] ? `${replyCounts[m.id]} ${replyCounts[m.id] === 1 ? "reply" : "replies"}` : "Reply in thread"}
                      </button>
                      {mine && editingId !== m.id && (() => {
                        const editable = Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;
                        return (
                          <>
                            {editable && (
                              <button
                                onClick={() => {
                                  setEditingId(m.id);
                                  setEditBody(m.body);
                                }}
                                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                              >
                                <Edit2 className="w-3 h-3" /> Edit
                              </button>
                            )}
                            <button
                              onClick={() => deleteMsg(m.id)}
                              className="text-[11px] text-destructive/80 hover:text-destructive inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </>
                        );
                      })()}
                      {!mine && isAdmin && editingId !== m.id && (
                        <button
                          onClick={() => {
                            if (confirm("Delete this message as admin? This cannot be undone.")) deleteMsg(m.id);
                          }}
                          className="text-[11px] text-destructive/80 hover:text-destructive inline-flex items-center gap-1"
                          title="Admin moderation: delete message"
                        >
                          <Shield className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>


        {Object.keys(typing).length > 0 && (
          <div className="px-4 py-1 text-xs text-muted-foreground italic border-t border-border bg-muted/30">
            {Object.keys(typing)
              .map(uid => allProfiles.find(p => p.id === uid)?.name)
              .filter(Boolean)
              .slice(0, 3)
              .join(", ")}{" "}
            typing…
          </div>
        )}
        <footer className="p-3 border-t border-border flex flex-col gap-2">
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-muted rounded-md px-2 py-1 text-xs">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="truncate max-w-[160px]">{f.name}</span>
                  <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {canAttach && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.pptx,.ppt,.csv,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={e => {
                    const list = Array.from(e.target.files ?? []);
                    const valid: File[] = [];
                    for (const f of list) {
                      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
                      if (!ALLOWED_EXT.includes(ext)) {
                        toast.error(`${f.name}: type not allowed`);
                        continue;
                      }
                      if (f.size > MAX_FILE_SIZE) {
                        toast.error(`${f.name}: exceeds 25MB`);
                        continue;
                      }
                      valid.push(f);
                    }
                    setPendingFiles(prev => [...prev, ...valid]);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={uploading || !activeId}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
              </>
            )}
            <div className="relative flex-1">
              {mentionQuery !== null && (() => {
                const q = mentionQuery.toLowerCase();
                const memberIds = members[activeId ?? ""] ?? [];
                const matches = allProfiles
                  .filter(p => p.id !== user?.id && memberIds.includes(p.id))
                  .filter(p => !q || p.name.toLowerCase().includes(q))
                  .slice(0, 6);
                if (matches.length === 0) return null;
                return (
                  <div className="absolute bottom-full mb-1 left-0 w-64 bg-popover border border-border rounded-md shadow-md overflow-hidden z-10">
                    {matches.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          // Replace the trailing @query in input with @Name
                          const updated = input.replace(/@(\S*)$/, `@${p.name} `);
                          setInput(updated);
                          setMentionQuery(null);
                          inputRef.current?.focus();
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                      >
                        <PresenceDot userId={p.id} />
                        <span className="truncate">{p.name}</span>
                        <Badge variant="outline" className="ml-auto text-[10px]">{p.role}</Badge>
                      </button>
                    ))}
                  </div>
                );
              })()}
              <Input
                ref={inputRef}
                placeholder="Type a message… (markdown supported, @mention members)"
                value={input}
                onChange={e => {
                  const v = e.target.value;
                  setInput(v);
                  sendTyping();
                  const m = /@(\S*)$/.exec(v);
                  setMentionQuery(m ? m[1] : null);
                }}
                disabled={uploading}
                onKeyDown={e => {
                  if (e.key === "Escape") setMentionQuery(null);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setMentionQuery(null);
                    sendMessage();
                  }
                }}
              />
            </div>
            <Button onClick={sendMessage} disabled={uploading || (!input.trim() && pendingFiles.length === 0)}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default ChatPage;

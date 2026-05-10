import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";
import { useChatUnread } from "@/contexts/ChatUnreadContext";

let sharedAudioCtx: AudioContext | null = null;

const playPing = () => {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // AudioContext not supported or blocked by autoplay policy
  }
};

/**
 * Listens for new chat_messages and shows:
 *  - In-app sonner toast for any message NOT in the currently-viewed channel
 *  - Browser system notification when the tab is hidden / app backgrounded
 *  - Soft audio ping on each notification
 * Only suppressed when the user is actively viewing the exact channel the message arrived in.
 */
const ChatNotifier = () => {
  const { user, allProfiles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { addUnread, activeChannelId } = useChatUnread();

  const profilesRef = useRef(allProfiles);
  profilesRef.current = allProfiles;

  const onChatPage = location.pathname.startsWith("/chat");
  const onChatRef = useRef(onChatPage);
  onChatRef.current = onChatPage;

  const activeChannelRef = useRef(activeChannelId);
  activeChannelRef.current = activeChannelId;

  const allowed = !!user && ["admin", "sales", "accounts", "service_head"].includes(user.role);

  // Request browser notification permission once
  useEffect(() => {
    if (!allowed) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !user) return;

    const sub = supabase
      .channel(`chat-notifier-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m: any = payload.new;
          if (!m || m.sender_id === user.id) return;

          const tabVisible =
            typeof document !== "undefined" && document.visibilityState === "visible";

          // Only suppress when user is ACTIVELY viewing this exact channel
          const isActiveChannel =
            onChatRef.current && tabVisible && activeChannelRef.current === m.channel_id;

          if (isActiveChannel) return;

          // Track unread for the channel
          addUnread(m.channel_id);

          const sender = profilesRef.current.find((p) => p.id === m.sender_id);
          const name = sender?.name ?? "Teammate";
          const role = sender?.role ? ` (${sender.role})` : "";
          const preview = String(m.body ?? "").slice(0, 120) || "(attachment)";

          // Always play ping + show toast for non-active-channel messages
          playPing();

          toast.message(`💬 ${name}${role}`, {
            description: preview,
            icon: <MessagesSquare className="w-4 h-4 text-primary" />,
            duration: 15000,
            action: {
              label: "Open Chat",
              onClick: () => navigate("/chat"),
            },
          });

          // Browser notification only when tab is not visible
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            !tabVisible
          ) {
            try {
              const n = new Notification(`💬 ${name}${role}`, {
                body: preview,
                tag: `chat-${m.channel_id}`,
                icon: "/placeholder.svg",
              });
              n.onclick = () => {
                window.focus();
                navigate("/chat");
                n.close();
              };
              setTimeout(() => n.close(), 15000);
            } catch {
              // ignore
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [allowed, user?.id, navigate, addUnread]);

  return null;
};

export default ChatNotifier;

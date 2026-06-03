import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";
import { useChatUnread } from "@/contexts/ChatUnreadContext";

import { emitChatArrival } from "@/components/ChatArrivalFlash";

let sharedAudioCtx: AudioContext | null = null;

/**
 * Loud two-tone ding-dong (E5 → C5), ~3× louder than the previous soft ping.
 */
const playPing = () => {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const playTone = (freq: number, startOffset: number, durationSec: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + startOffset;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.45, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + durationSec + 0.05);
    };

    // Ding (E5) then Dong (C5)
    playTone(659.25, 0, 0.6);
    playTone(523.25, 0.18, 0.7);
  } catch {
    // AudioContext not supported or blocked
  }
};

/**
 * Listens for new chat_messages and shows:
 *  - In-app sonner toast (cloud banner) on any dashboard
 *  - Browser system notification when the tab is hidden / app backgrounded
 *  - Soft audio ping on each new message
 * Tracks per-channel unread counts via ChatUnreadContext.
 * Suppresses toast while user is on /chat with the tab visible.
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
    const channel = supabase
      .channel(`chat-notifier-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m: any = payload.new;
          if (!m || m.sender_id === user.id) return;

          const tabVisible = typeof document !== "undefined" && document.visibilityState === "visible";
          const isActiveChannel = onChatRef.current && tabVisible && activeChannelRef.current === m.channel_id;

          // Track unread for any channel the user isn't currently viewing
          if (!isActiveChannel) {
            addUnread(m.channel_id);
          }

          // Suppress toast when user is on chat page with tab in focus
          const suppressToast = onChatRef.current && tabVisible;
          if (suppressToast) return;

          const sender = profilesRef.current.find(p => p.id === m.sender_id);
          const name = sender?.name ?? "Teammate";
          const role = sender?.role ? ` (${sender.role})` : "";
          const preview = String(m.body ?? "").slice(0, 120) || "(attachment)";

          playPing();

          toast.message(`💬 ${name}${role}`, {
            description: preview,
            icon: <MessagesSquare className="w-4 h-4 text-primary" />,
            duration: 20000,
            action: {
              label: "Open Chat",
              onClick: () => navigate("/chat"),
            },
          });

          // System notification when tab not visible
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
              setTimeout(() => n.close(), 20000);
            } catch {
              // ignore
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [allowed, user?.id, navigate, addUnread]);

  return null;
};

export default ChatNotifier;

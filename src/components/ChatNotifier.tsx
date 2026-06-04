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
    // AudioContext not supported or blocked by autoplay policy
  }
};

// Show a system notification that appears in the phone's notification shade.
// Android Chrome (62+) dropped support for new Notification() from a page
// context; it must go through ServiceWorkerRegistration.showNotification().
const showSystemNotification = async (
  title: string,
  body: string,
  tag: string,
) => {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        tag,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: "/chat" },
        vibrate: [200, 100, 200],
        requireInteraction: false,
      } as any);
      return;
    }
  } catch {
    // Service worker not available — fall through to legacy API
  }

  // Fallback: desktop browsers where new Notification() still works
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: "/icon-192.png",
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 15000);
  } catch {
    // ignore
  }
};

/**
 * Listens for new chat_messages and shows:
 *  - In-app sonner toast for any message NOT in the currently-viewed channel
 *  - System notification (home screen shade on mobile) when app is backgrounded
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

          // Always play ping + show in-app toast
          playPing();
          emitChatArrival({ sender: name, role: sender?.role, preview });

          toast.message(`💬 ${name}${role}`, {
            description: preview,
            icon: <MessagesSquare className="w-4 h-4 text-primary" />,
            duration: 15000,
            action: {
              label: "Open Chat",
              onClick: () => navigate("/chat"),
            },
          });

          // System notification when tab is not visible (home screen / notification shade)
          if (!tabVisible) {
            showSystemNotification(
              `💬 ${name}${role}`,
              preview,
              `chat-${m.channel_id}`,
            );
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

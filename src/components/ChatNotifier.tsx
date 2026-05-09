import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";

/**
 * Listens for new chat_messages and shows:
 *  - In-app sonner toast (cloud banner) on any dashboard
 *  - Browser system notification when the tab is hidden / app backgrounded
 * Notifications persist 20 seconds. Suppressed while user is on /chat actively.
 */
const ChatNotifier = () => {
  const { user, allProfiles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const profilesRef = useRef(allProfiles);
  profilesRef.current = allProfiles;
  const onChatPage = location.pathname.startsWith("/chat");
  const onChatRef = useRef(onChatPage);
  onChatRef.current = onChatPage;

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
          // Suppress only if user is actively on chat page AND tab is visible
          const tabVisible = typeof document !== "undefined" && document.visibilityState === "visible";
          if (onChatRef.current && tabVisible) return;

          const sender = profilesRef.current.find(p => p.id === m.sender_id);
          const name = sender?.name ?? "Teammate";
          const role = sender?.role ? ` (${sender.role})` : "";
          const preview = String(m.body ?? "").slice(0, 120) || "(attachment)";

          // In-app cloud banner (sonner)
          toast.message(`💬 ${name}${role}`, {
            description: preview,
            icon: <MessagesSquare className="w-4 h-4" />,
            duration: 20000,
            action: {
              label: "Open",
              onClick: () => navigate("/chat"),
            },
          });

          // System tray notification when tab not visible
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
  }, [allowed, user?.id, navigate]);

  return null;
};

export default ChatNotifier;

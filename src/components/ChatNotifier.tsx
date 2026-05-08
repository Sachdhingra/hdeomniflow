import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MessagesSquare } from "lucide-react";

/**
 * Listens to all chat_messages inserts the user is allowed to see (RLS already
 * filters to channels the user is a member of) and shows a "cloud" toast on
 * any dashboard so users notice new messages without being on the chat page.
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
          if (onChatRef.current) return; // don't toast while on chat page
          const sender = profilesRef.current.find(p => p.id === m.sender_id);
          const name = sender?.name ?? "Teammate";
          const preview = String(m.body ?? "").slice(0, 120);
          toast.message(`💬 ${name}`, {
            description: preview || "(attachment)",
            icon: <MessagesSquare className="w-4 h-4" />,
            action: {
              label: "Open",
              onClick: () => navigate("/chat"),
            },
          });
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

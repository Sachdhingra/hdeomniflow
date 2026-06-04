import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Target } from "lucide-react";

let sharedAudioCtx: AudioContext | null = null;

const playLeadPing = () => {
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
    osc.frequency.value = 660;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // AudioContext not supported or blocked
  }
};

/**
 * Listens for new lead_assigned notifications and shows:
 *  - In-app sonner toast with "View Leads" action
 *  - Browser system notification when the tab is hidden
 *  - Distinct audio ping
 * Only active for sales and service_head roles (the recipients).
 */
const LeadNotifier = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const allowed = !!user && ["sales", "service_head"].includes(user.role);

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
      .channel(`lead-notifier-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const n: any = payload.new;
          if (!n || n.type !== "lead_assigned") return;

          playLeadPing();

          const tabVisible =
            typeof document !== "undefined" && document.visibilityState === "visible";

          toast.message("🎯 New Lead Assigned", {
            description: n.message,
            icon: <Target className="w-4 h-4 text-primary" />,
            duration: 25000,
            action: {
              label: "View Leads",
              onClick: () => navigate("/leads"),
            },
          });

          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            !tabVisible
          ) {
            try {
              const notif = new Notification("🎯 New Lead Assigned", {
                body: n.message,
                tag: `lead-${n.id}`,
                icon: "/placeholder.svg",
              });
              notif.onclick = () => {
                window.focus();
                navigate("/leads");
                notif.close();
              };
              setTimeout(() => notif.close(), 25000);
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

export default LeadNotifier;

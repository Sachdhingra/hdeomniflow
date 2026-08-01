import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ClipboardList, Clock } from "lucide-react";

let sharedAudioCtx: AudioContext | null = null;

/**
 * Two-tone ding-dong (E5 → C5) — same voice as chat arrivals so it cuts
 * through on the shop floor.
 */
const playDingDong = () => {
  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const playTone = (freq: number, startOffset: number, durationSec: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
      osc.start(t);
      osc.stop(t + durationSec);
    };
    playTone(659.25, 0, 0.6);
    playTone(523.25, 0.18, 0.7);
  } catch {
    // AudioContext not supported or blocked by autoplay policy
  }
};

const ORDER_TYPES: Record<string, { title: string; reminder: boolean }> = {
  order_approval: { title: "🧾 Order Awaiting Approval", reminder: false },
  order_service: { title: "🔧 Order Ready for Service", reminder: false },
  order_approval_reminder: { title: "⏰ Approval Pending Reminder", reminder: true },
  order_service_reminder: { title: "⏰ Service Pending Reminder", reminder: true },
  order_reminder: { title: "⏰ Open Order Reminder", reminder: true },
};

/**
 * Listens for order workflow notifications targeted at the signed-in user and
 * surfaces them as:
 *  - ding-dong audio ping
 *  - in-app toast on whatever screen is open (incl. home) with a View action
 *  - browser system notification when the tab is hidden
 * Recipient targeting is done in the DB (rows are per user_id), so no role
 * gating is needed here.
 */
const OrderNotifier = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`order-notifier-${user.id}`)
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
          const kind = n?.type ? ORDER_TYPES[n.type] : undefined;
          if (!n || !kind) return;

          playDingDong();

          const tabVisible =
            typeof document !== "undefined" && document.visibilityState === "visible";

          toast.message(kind.title, {
            description: n.message,
            icon: kind.reminder
              ? <Clock className="w-4 h-4 text-warning" />
              : <ClipboardList className="w-4 h-4 text-primary" />,
            duration: 25000,
            action: {
              label: "View Orders",
              onClick: () => navigate(n.link || "/inventory"),
            },
          });

          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            !tabVisible
          ) {
            try {
              const notif = new Notification(kind.title, {
                body: n.message,
                tag: `order-${n.id}`,
                icon: "/placeholder.svg",
              });
              notif.onclick = () => {
                window.focus();
                navigate(n.link || "/inventory");
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
  }, [user?.id, navigate]);

  return null;
};

export default OrderNotifier;

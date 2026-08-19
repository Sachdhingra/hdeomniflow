import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
import { Star, Coins, Bell } from "lucide-react";

let sharedCtx: AudioContext | null = null;

function playLoyaltyDing() {
  try {
    if (!sharedCtx) {
      sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = sharedCtx;
    if (ctx.state === "suspended") ctx.resume();
    const tone = (freq: number, t0: number, dur: number) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + t0;
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    };
    tone(880,  0,    0.5);  // A5
    tone(1047, 0.18, 0.55); // C6
  } catch { /* AudioContext blocked */ }
}

const PUSH_EMOJI: Record<string, string> = {
  birthday:          "🎂",
  birthday_bonus:    "🎁",
  anniversary_bonus: "🎉",
  points_expiring:   "⏳",
  card_expiring:     "🪪",
  dormant:           "💤",
  points_balance:    "💰",
};

/**
 * Mounts in AppLayout (renders nothing).
 * Subscribes to loyalty realtime events and surfaces them as
 * ding + toast for the relevant role:
 *   - push_notifications_log INSERT  → admin / accounts
 *   - redemption_requests INSERT      → admin / accounts
 *   - card_commissions INSERT (own)   → admin / sales
 */
const LoyaltyAlertNotifier = () => {
  const { user } = useAuth();
  const navigate  = useNavigate();

  useEffect(() => {
    if (!user) return;

    const role              = user.role;
    const isAdminOrAccounts = role === "admin" || role === "accounts";
    const isSalesOrAdmin    = role === "admin" || role === "sales";
    const channels: ReturnType<typeof supabase.channel>[] = [];

    // ── 1. Push notification log ────────────────────────────────────────────
    if (isAdminOrAccounts) {
      const pushCh = supabase
        .channel(`loyalty-push-log-${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "push_notifications_log" },
          (payload) => {
            const n: any = payload.new;
            const emoji  = PUSH_EMOJI[n.notification_type as string] ?? "🔔";
            const label  = (n.notification_type as string).replace(/_/g, " ");
            playLoyaltyDing();
            toast.message(`${emoji} Push sent — ${label}`, {
              description: n.title as string,
              icon:   <Bell className="w-4 h-4 text-primary" />,
              duration: 12000,
              action: { label: "Push Log", onClick: () => navigate("/loyalty-dashboard") },
            });
          },
        )
        .subscribe();
      channels.push(pushCh);
    }

    // ── 2. Redemption requests ──────────────────────────────────────────────
    if (isAdminOrAccounts) {
      const redCh = supabase
        .channel(`loyalty-redemption-alert-${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "redemption_requests" },
          () => {
            playLoyaltyDing();
            toast.message("💳 New Redemption Request", {
              description: "A customer has submitted a redemption — awaiting your approval.",
              icon:   <Coins className="w-4 h-4 text-amber-500" />,
              duration: 25000,
              action: { label: "Review", onClick: () => navigate("/loyalty-points") },
            });
          },
        )
        .subscribe();
      channels.push(redCh);
    }

    // ── 3. Commission earned (own rows only) ────────────────────────────────
    if (isSalesOrAdmin) {
      const commCh = supabase
        .channel(`loyalty-commission-alert-${user.id}`)
        .on(
          "postgres_changes",
          {
            event:  "INSERT",
            schema: "public",
            table:  "card_commissions",
            filter: `salesperson_id=eq.${user.id}`,
          },
          (payload) => {
            const n    = payload.new as any;
            const tier = (n.card_tier as string)
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c: string) => c.toUpperCase());
            playLoyaltyDing();
            toast.message(`⭐ Commission Earned — ₹${n.commission_amount}`, {
              description: `${tier} card enrollment`,
              icon:   <Star className="w-4 h-4 text-amber-500" />,
              duration: 15000,
              action: { label: "Commissions", onClick: () => navigate("/loyalty-dashboard") },
            });
          },
        )
        .subscribe();
      channels.push(commCh);
    }

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [user?.id, user?.role, navigate]);

  return null;
};

export default LoyaltyAlertNotifier;

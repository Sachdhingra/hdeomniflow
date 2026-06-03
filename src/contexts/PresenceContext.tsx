import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PresenceStatus = "online" | "away" | "offline";

interface PresenceMap {
  [userId: string]: PresenceStatus;
}

interface PresenceContextType {
  presence: PresenceMap;
  myStatus: PresenceStatus;
}

const PresenceContext = createContext<PresenceContextType>({ presence: {}, myStatus: "offline" });

const AWAY_AFTER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Broadcasts the current user's presence and tracks all teammates' status
 * via a single Supabase Realtime presence channel. Persists last_activity
 * to user_presence as a fallback when realtime is unavailable.
 */
export const PresenceProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [presence, setPresence] = useState<PresenceMap>({});
  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");
  const idleTimerRef = useRef<number | undefined>();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Join the global presence channel
  useEffect(() => {
    if (!user) return;

    const ch = supabase.channel("global-presence", {
      config: { presence: { key: user.id } },
    });
    channelRef.current = ch;

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState() as Record<string, Array<{ status?: PresenceStatus }>>;
      const next: PresenceMap = {};
      for (const [uid, metas] of Object.entries(state)) {
        // If any meta is online → online, else away
        const statuses = metas.map(m => m.status ?? "online");
        next[uid] = statuses.includes("online")
          ? "online"
          : statuses.includes("away")
            ? "away"
            : "offline";
      }
      setPresence(next);
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ status: "online", at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [user?.id]);

  // Idle detection
  useEffect(() => {
    if (!user) return;

    const setStatus = async (next: PresenceStatus) => {
      setMyStatus(next);
      if (channelRef.current) {
        try {
          await channelRef.current.track({ status: next, at: new Date().toISOString() });
        } catch {}
      }
      // Best-effort DB write (ignore failures, RLS-scoped)
      supabase
        .from("user_presence")
        .upsert({ user_id: user.id, status: next, last_activity: new Date().toISOString(), updated_at: new Date().toISOString() })
        .then(() => {});
    };

    const resetIdle = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      if (myStatus !== "online") setStatus("online");
      idleTimerRef.current = window.setTimeout(() => setStatus("away"), AWAY_AFTER_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setStatus("away");
      } else {
        resetIdle();
      }
    };

    const onBeforeUnload = () => {
      // fire and forget
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_presence?user_id=eq.${user.id}`,
      );
      setStatus("offline");
    };

    window.addEventListener("mousemove", resetIdle, { passive: true });
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("touchstart", resetIdle, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    resetIdle();

    return () => {
      window.removeEventListener("mousemove", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("touchstart", resetIdle);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <PresenceContext.Provider value={{ presence, myStatus }}>{children}</PresenceContext.Provider>
  );
};

export const usePresence = () => useContext(PresenceContext);

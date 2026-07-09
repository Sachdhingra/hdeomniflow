import { useEffect, useRef, useState } from "react";
import { MapPin, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFieldAgentDuty } from "@/hooks/useFieldAgentDuty";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase: any = _supabase;

const istToday = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
};

const PROBE_INTERVAL_MS = 15_000;
const AGGRESSIVE_PROBE_INTERVAL_MS = 5_000;
const SIGNAL_LOST_THRESHOLD_MS = 5 * 60_000;

/**
 * Fullscreen GPS/connectivity enforcement for Field Agents on duty.
 * - Continuously probes GPS permission + fix availability.
 * - Blocks the entire app behind a modal when GPS is off/denied.
 * - Logs gps_off / gps_restored / offline / online / signal_lost /
 *   signal_restored events to public.agent_signal_logs.
 */
const FieldAgentGpsGuard = () => {
  const { user } = useAuth();
  const { isOnDuty, isFieldAgent } = useFieldAgentDuty();

  const enforce = !!user && isFieldAgent && isOnDuty;

  const [gpsOk, setGpsOk] = useState<boolean>(true);
  const [gpsMessage, setGpsMessage] = useState<string>("");
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  const lastFixRef = useRef<number | null>(null);
  const gpsOffSinceRef = useRef<number | null>(null);
  const offlineSinceRef = useRef<number | null>(null);
  const signalLostSinceRef = useRef<number | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const probeIntervalRef = useRef<number>(PROBE_INTERVAL_MS);

  const logEvent = async (
    eventType:
      | "gps_off"
      | "gps_restored"
      | "offline"
      | "online"
      | "signal_lost"
      | "signal_restored",
    durationMinutes?: number
  ) => {
    if (!user) return;
    try {
      await supabase.from("agent_signal_logs").insert({
        agent_id: user.id,
        agent_name: user.name,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        shift_date: istToday(),
        duration_minutes: durationMinutes ?? null,
      });
    } catch {
      /* silent */
    }
  };

  const logTamperingAttempt = async (eventType: string, failureCount: number) => {
    if (!user) return;
    try {
      await supabase.from("gps_tampering_attempts").insert({
        agent_id: user.id,
        event_type: eventType,
        failure_count: failureCount,
        shift_date: istToday(),
      });
    } catch {
      /* silent */
    }
  };

  // Online / offline tracking
  useEffect(() => {
    if (!enforce) return;
    const handleOnline = () => {
      setOnline(true);
      if (offlineSinceRef.current) {
        const mins = Math.round((Date.now() - offlineSinceRef.current) / 60_000);
        offlineSinceRef.current = null;
        logEvent("online", mins);
      }
    };
    const handleOffline = () => {
      setOnline(false);
      offlineSinceRef.current = Date.now();
      logEvent("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enforce, user?.id]);

  // GPS probing
  useEffect(() => {
    if (!enforce) {
      // Reset state when leaving duty
      lastFixRef.current = null;
      gpsOffSinceRef.current = null;
      signalLostSinceRef.current = null;
      setGpsOk(true);
      setGpsMessage("");
      return;
    }

    let cancelled = false;

    const markGpsOff = (reason: string) => {
      if (cancelled) return;
      if (gpsOk) {
        gpsOffSinceRef.current = Date.now();
        logEvent("gps_off");
      }
      setGpsOk(false);
      setGpsMessage(reason);
    };

    const markGpsOk = () => {
      if (cancelled) return;
      if (!gpsOk) {
        const mins = gpsOffSinceRef.current
          ? Math.round((Date.now() - gpsOffSinceRef.current) / 60_000)
          : undefined;
        gpsOffSinceRef.current = null;
        logEvent("gps_restored", mins);
      }
      setGpsOk(true);
      setGpsMessage("");
    };

    const probe = () => {
      if (!navigator.geolocation) {
        markGpsOff("GPS is not supported on this device.");
        consecutiveFailuresRef.current++;
        probeIntervalRef.current = AGGRESSIVE_PROBE_INTERVAL_MS;
        return;
      }

      navigator.geolocation.getCurrentPosition(
        () => {
          lastFixRef.current = Date.now();
          consecutiveFailuresRef.current = 0;
          probeIntervalRef.current = PROBE_INTERVAL_MS;
          markGpsOk();
          // Restore signal-lost if any
          if (signalLostSinceRef.current) {
            const mins = Math.round(
              (Date.now() - signalLostSinceRef.current) / 60_000
            );
            signalLostSinceRef.current = null;
            logEvent("signal_restored", mins);
          }
        },
        (err) => {
          consecutiveFailuresRef.current++;
          probeIntervalRef.current = AGGRESSIVE_PROBE_INTERVAL_MS;

          if (consecutiveFailuresRef.current > 1 && consecutiveFailuresRef.current % 3 === 0) {
            logTamperingAttempt(`gps_probe_failure_${err.code}`, consecutiveFailuresRef.current);
          }

          if (err.code === err.PERMISSION_DENIED) {
            markGpsOff("Location permission is denied. Enable GPS to continue duty.");
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            markGpsOff("GPS signal unavailable. Check GPS is enabled.");
          } else if (err.code === err.TIMEOUT) {
            if (!lastFixRef.current) {
              markGpsOff("GPS signal unavailable. Check GPS is enabled.");
            }
          } else {
            markGpsOff("Location is required to continue duty.");
          }
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8_000 }
      );

      // Signal-lost detection (5 min without a fresh fix)
      if (
        lastFixRef.current &&
        Date.now() - lastFixRef.current > SIGNAL_LOST_THRESHOLD_MS &&
        !signalLostSinceRef.current
      ) {
        signalLostSinceRef.current = Date.now();
        logEvent("signal_lost");
      }
    };

    probe();
    let id = window.setInterval(probe, PROBE_INTERVAL_MS);

    const adjustInterval = () => {
      window.clearInterval(id);
      id = window.setInterval(probe, probeIntervalRef.current);
    };
    const adjustId = window.setInterval(adjustInterval, 5000);

    // Permissions API live updates (where supported)
    let permStatus: PermissionStatus | null = null;
    const permHandler = () => probe();
    if (typeof navigator !== "undefined" && (navigator as any).permissions?.query) {
      (navigator as any).permissions
        .query({ name: "geolocation" as PermissionName })
        .then((status: PermissionStatus) => {
          permStatus = status;
          status.addEventListener?.("change", permHandler);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearInterval(adjustId);
      permStatus?.removeEventListener?.("change", permHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enforce, user?.id]);

  if (!enforce) return null;

  const showBlocker = !gpsOk || !online;
  if (!showBlocker) return null;

  const offlineBlock = !online;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6"
      role="alertdialog"
      aria-modal="true"
      // Prevent any interaction with content behind
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-xl p-6 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
          {offlineBlock ? (
            <AlertTriangle className="w-7 h-7 text-destructive" />
          ) : (
            <MapPin className="w-7 h-7 text-destructive" />
          )}
        </div>
        <h2 className="text-xl font-bold">
          {offlineBlock ? "📡 Internet Required" : "📍 Location Required"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {offlineBlock
            ? "You're offline. Please reconnect to the internet to continue your duty."
            : "Please enable GPS to continue your duty. Your location is required for job tracking."}
        </p>
        {gpsMessage && !offlineBlock && (
          <p className="text-xs text-destructive">{gpsMessage}</p>
        )}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border">
          This block will clear automatically as soon as{" "}
          {offlineBlock ? "you're back online" : "GPS is re-enabled"}.
        </div>
      </div>
    </div>
  );
};

export default FieldAgentGpsGuard;

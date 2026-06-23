import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const istToday = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
};

const istNowParts = () => {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = fmt.format(new Date()).split(":").map(Number);
  return { h, m };
};

const isPastAutoLogout = () => {
  const { h, m } = istNowParts();
  return h > 20 || (h === 20 && m >= 5);
};

const ACTIVE_TRACKING_JOB_STATUSES = ["assigned", "on_route", "on_site", "in_progress"];

/**
 * Tracks whether a field_agent is currently "on duty" (clocked in, not out,
 * before 8:05 PM IST auto-logout). For field_agents on duty, captures GPS
 * coordinates every 60 seconds into `agent_live_locations`. No-op for other
 * roles.
 */
export const useFieldAgentDuty = () => {
  const { user } = useAuth();
  const [isOnDuty, setIsOnDuty] = useState(false);
  const [isTrackingActive, setIsTrackingActive] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const checkRef = useRef<number | null>(null);

  const isFieldAgent = user?.role === "field_agent";

  const refreshDuty = useCallback(async () => {
    if (!user || !isFieldAgent) {
      setIsOnDuty(false);
      setIsTrackingActive(false);
      return;
    }
    if (isPastAutoLogout()) {
      setIsOnDuty(false);
      setIsTrackingActive(false);
      return;
    }
    const [{ data: attendance }, { data: activeJobs }] = await Promise.all([
      (supabase as any)
        .from("attendance")
        .select("clock_in, clock_out")
        .eq("user_id", user.id)
        .eq("date", istToday())
        .maybeSingle(),
      (supabase as any)
        .from("service_jobs")
        .select("id")
        .eq("assigned_agent", user.id)
        .is("deleted_at", null)
        .in("status", ACTIVE_TRACKING_JOB_STATUSES)
        .limit(1),
    ]);

    const dutyFromClock = !!(attendance?.clock_in && !attendance?.clock_out);
    const dutyFromActiveJob = Array.isArray(activeJobs) && activeJobs.length > 0;
    setIsOnDuty(dutyFromClock);
    setIsTrackingActive(dutyFromClock || dutyFromActiveJob);
  }, [user, isFieldAgent]);

  // Poll duty status every 60s and on mount
  useEffect(() => {
    refreshDuty();
    if (checkRef.current) window.clearInterval(checkRef.current);
    checkRef.current = window.setInterval(refreshDuty, 60_000);
    return () => {
      if (checkRef.current) window.clearInterval(checkRef.current);
    };
  }, [refreshDuty]);

  // Capture + push location every 60s while on duty
  useEffect(() => {
    if (!user || !isFieldAgent || !isTrackingActive) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const pushPing = () => {
      if (!navigator.geolocation) return;
      if (isPastAutoLogout()) {
        setIsOnDuty(false);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { error } = await (supabase as any).from("agent_live_locations").insert({
              agent_id: user.id,
              agent_name: user.name,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              shift_date: istToday(),
            });
            if (error) throw error;
          } catch {
            /* silent */
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 }
      );
    };

    pushPing();
    intervalRef.current = window.setInterval(pushPing, 60_000);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user, isFieldAgent, isTrackingActive]);

  return { isOnDuty, isFieldAgent, refreshDuty };
};

import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { detectLocationAnomalies, detectGpsSpoofingg } from "@/lib/locationAnomalyDetection";

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
}

const ANALYSIS_WINDOW_MINUTES = 30;
const CHECK_INTERVAL_MS = 5 * 60_000;

export function useLocationSpoofingDetector(enabled: boolean) {
  const { user } = useAuth();
  const locationHistoryRef = useRef<LocationPoint[]>([]);

  useEffect(() => {
    if (!enabled || !user) return;

    let cancelled = false;

    const analyzeLocationHistory = async () => {
      if (!user || cancelled) return;

      try {
        const { data: locations } = await supabase
          .from("agent_live_locations")
          .select("latitude, longitude, accuracy, timestamp")
          .eq("agent_id", user.id)
          .gte(
            "timestamp",
            new Date(Date.now() - ANALYSIS_WINDOW_MINUTES * 60_000).toISOString()
          )
          .order("timestamp", { ascending: true });

        if (!locations || locations.length < 3) return;

        const points: LocationPoint[] = locations.map((loc: any) => ({
          lat: loc.latitude,
          lng: loc.longitude,
          timestamp: new Date(loc.timestamp).getTime(),
          accuracy: loc.accuracy ?? 50,
        }));

        locationHistoryRef.current = points;

        const anomalyResult = detectLocationAnomalies(points);
        const spoofingResult = detectGpsSpoofingg(points);

        if (anomalyResult.isAnomalous && anomalyResult.confidence > 0.7) {
          await logLocationAnomaly(user.id, "anomalous_movement", anomalyResult.reasons, anomalyResult.confidence, points.length);
        }

        if (spoofingResult.isAnomalous && spoofingResult.confidence > 0.7) {
          await logLocationAnomaly(user.id, "likely_spoofing", spoofingResult.reasons, spoofingResult.confidence, points.length);
        }
      } catch (err) {
        console.error("Location analysis error:", err);
      }
    };

    analyzeLocationHistory();
    const id = window.setInterval(analyzeLocationHistory, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, user]);
}

async function logLocationAnomaly(
  agentId: string,
  anomalyType: string,
  reasons: string[],
  confidence: number,
  locationCount: number
) {
  try {
    await supabase.from("location_anomalies").insert({
      agent_id: agentId,
      anomaly_type: anomalyType,
      reasons,
      confidence: Math.round(confidence * 100) / 100,
      location_count: locationCount,
      analysis_window_minutes: ANALYSIS_WINDOW_MINUTES,
    });
  } catch {
    /* silent */
  }
}

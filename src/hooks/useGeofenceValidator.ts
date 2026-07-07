import { useEffect, useRef, useState } from "react";
import { distanceMeters, GeoPosition } from "./useGeolocation";
import { supabase } from "@/integrations/supabase/client";

interface Geofence {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export const GEOFENCE_CHECK_INTERVAL_MS = 60_000;
export const GEOFENCE_VIOLATION_THRESHOLD_MS = 2 * 60_000;

export function useGeofenceValidator(jobId: string | null, jobLocation: { lat: number; lng: number } | null, enabled: boolean) {
  const [isInGeofence, setIsInGeofence] = useState(true);
  const [geofenceViolations, setGeofenceViolations] = useState(0);
  const lastPositionRef = useRef<GeoPosition | null>(null);
  const violationStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !jobId || !jobLocation || typeof navigator === "undefined") return;

    let cancelled = false;

    const checkGeofence = async () => {
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;

          const current: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          };

          const distance = distanceMeters(current, jobLocation);
          const geofenceRadius = 150;

          lastPositionRef.current = current;

          if (distance > geofenceRadius) {
            if (!violationStartRef.current) {
              violationStartRef.current = Date.now();
            }

            const violationDuration = Date.now() - violationStartRef.current;
            if (violationDuration > GEOFENCE_VIOLATION_THRESHOLD_MS) {
              setIsInGeofence(false);
              setGeofenceViolations((v) => v + 1);

              logGeofenceViolation(jobId, {
                lat: current.lat,
                lng: current.lng,
                distance,
              });
            }
          } else {
            violationStartRef.current = null;
            setIsInGeofence(true);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 8_000 }
      );
    };

    checkGeofence();
    const id = window.setInterval(checkGeofence, GEOFENCE_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId, jobLocation, enabled]);

  return { isInGeofence, geofenceViolations };
}

async function logGeofenceViolation(jobId: string, location: { lat: number; lng: number; distance: number }) {
  try {
    await supabase.from("geofence_violations").insert({
      job_id: jobId,
      latitude: location.lat,
      longitude: location.lng,
      distance_from_site: Math.round(location.distance),
      recorded_at: new Date().toISOString(),
    });
  } catch {
    /* silent */
  }
}

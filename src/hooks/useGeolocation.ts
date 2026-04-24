import { useEffect, useRef, useState } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

/** Haversine distance in meters */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Continuously watches user position. Returns latest fix + odometer (km traveled). */
export function useGeolocation(enabled: boolean) {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kmTraveled, setKmTraveled] = useState(0);
  const lastRef = useRef<GeoPosition | null>(null);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        const prev = lastRef.current;
        if (prev) {
          const d = distanceMeters(prev, next);
          // Filter noise: ignore tiny jitter (<10m) and unrealistic jumps (>500m in <5s)
          const dt = (next.timestamp - prev.timestamp) / 1000;
          if (d >= 10 && !(d > 500 && dt < 5)) {
            setKmTraveled((k) => k + d / 1000);
            lastRef.current = next;
          }
        } else {
          lastRef.current = next;
        }
        setPosition(next);
        setError(null);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  const resetOdometer = () => {
    setKmTraveled(0);
    lastRef.current = position;
  };

  return { position, error, kmTraveled, resetOdometer };
}

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
}

export interface AnomalyDetectionResult {
  isAnomalous: boolean;
  reasons: string[];
  confidence: number;
}

const EARTH_RADIUS_M = 6371000;

function haversineDistance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

export function detectLocationAnomalies(points: LocationPoint[]): AnomalyDetectionResult {
  const reasons: string[] = [];
  let confidence = 0;

  if (points.length < 2) {
    return { isAnomalous: false, reasons, confidence: 0 };
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const distance = haversineDistance(prev, curr);
    const timeDiff = (curr.timestamp - prev.timestamp) / 1000;

    if (timeDiff <= 0) {
      reasons.push("Negative time difference detected");
      confidence += 0.5;
      continue;
    }

    const speed = distance / timeDiff;
    const maxHumanSpeed = 25;
    const maxVehicleSpeed = 60;

    if (speed > maxVehicleSpeed) {
      reasons.push(`Impossible speed: ${(speed * 3.6).toFixed(0)} km/h`);
      confidence += 0.8;
    } else if (speed > maxHumanSpeed && speed <= maxVehicleSpeed) {
      reasons.push(`High speed detected: ${(speed * 3.6).toFixed(0)} km/h (unusual for field work)`);
      confidence += 0.3;
    }

    if (curr.accuracy > 100 && prev.accuracy > 100) {
      reasons.push("Poor GPS accuracy detected");
      confidence += 0.2;
    }
  }

  const stationaryPoints = points.filter((p, i, arr) => {
    if (i === 0) return false;
    const dist = haversineDistance(arr[i - 1], p);
    return dist < 10;
  });

  if (stationaryPoints.length === points.length - 1) {
    reasons.push("Location stationary for extended period (>30 min)");
    confidence += 0.4;
  }

  const isAnomalous = confidence > 0.5;
  return { isAnomalous, reasons, confidence: Math.min(1, confidence) };
}

export function detectGpsSpoofingg(points: LocationPoint[]): AnomalyDetectionResult {
  const reasons: string[] = [];
  let confidence = 0;

  if (points.length < 3) {
    return { isAnomalous: false, reasons, confidence: 0 };
  }

  const distances: number[] = [];
  for (let i = 1; i < points.length; i++) {
    distances.push(haversineDistance(points[i - 1], points[i]));
  }

  const avgDistance = distances.reduce((a, b) => a + b) / distances.length;
  const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2)) / distances.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 1 && avgDistance < 5) {
    reasons.push("Suspiciously uniform movement pattern");
    confidence += 0.6;
  }

  const accuracies = points.map((p) => p.accuracy);
  const avgAccuracy = accuracies.reduce((a, b) => a + b) / accuracies.length;

  if (avgAccuracy < 5 && points.length > 5) {
    reasons.push("Unrealistically high GPS accuracy throughout");
    confidence += 0.4;
  }

  if (distances.some((d) => d === 0)) {
    reasons.push("Duplicate positions recorded");
    confidence += 0.3;
  }

  const isAnomalous = confidence > 0.5;
  return { isAnomalous, reasons, confidence: Math.min(1, confidence) };
}

# GPS Tracking Evasion Prevention - Integration Guide

## Quick Start

This guide shows how to integrate the unavoidable GPS tracking system into your field agent app.

## 1. Update FieldAgentDashboard

Add the spoofing detector to actively monitor for anomalies:

```tsx
import { useLocationSpoofingDetector } from "@/hooks/useLocationSpoofingDetector";
import FieldAgentGpsGuard from "@/components/FieldAgentGpsGuard";

export function FieldAgentDashboard() {
  const { isOnDuty } = useFieldAgentDuty();
  
  // Activate spoofing detection while on duty
  useLocationSpoofingDetector(isOnDuty);
  
  return (
    <>
      <FieldAgentGpsGuard />
      {/* Rest of dashboard */}
    </>
  );
}
```

## 2. Job Start Workflow

Before allowing an agent to start a job, validate GPS is working:

```tsx
import { JobStartGpsValidator } from "@/components/JobStartGpsValidator";

export function JobCard({ job }: { job: ServiceJob }) {
  const [validatingGps, setValidatingGps] = useState(false);
  
  return (
    <>
      {validatingGps && (
        <JobStartGpsValidator
          jobId={job.id}
          onValidationComplete={(valid, position) => {
            if (valid) {
              startJobWithPosition(job.id, position);
              setValidatingGps(false);
            } else {
              // Validation failed, show error
              setValidatingGps(false);
            }
          }}
        />
      )}
      
      <button onClick={() => setValidatingGps(true)}>
        Start Job
      </button>
    </>
  );
}
```

## 3. Active Job Geofence Monitoring

While a job is active, continuously validate the agent is at the site:

```tsx
import { useGeofenceValidator } from "@/hooks/useGeofenceValidator";

export function ActiveJobStatus({ job }: { job: ServiceJob }) {
  const { isInGeofence, geofenceViolations } = useGeofenceValidator(
    job.id,
    {
      lat: job.site_latitude,
      lng: job.site_longitude
    },
    true // Enable geofence checking
  );
  
  return (
    <div>
      {!isInGeofence && (
        <div className="bg-red-500/10 border border-red-500 rounded p-3">
          ⚠️ You've left the job site. Please return to continue.
        </div>
      )}
      
      {geofenceViolations > 0 && (
        <div className="text-sm text-destructive">
          {geofenceViolations} site departures recorded
        </div>
      )}
    </div>
  );
}
```

## 4. Location Anomaly Analysis

For backend admin dashboards, analyze location history for suspicious patterns:

```tsx
import { detectLocationAnomalies } from "@/lib/locationAnomalyDetection";

async function analyzeAgentMovement(agentId: string) {
  // Fetch last 30 minutes of location data
  const { data: locations } = await supabase
    .from("agent_live_locations")
    .select("latitude, longitude, accuracy, timestamp")
    .eq("agent_id", agentId)
    .gte("timestamp", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("timestamp", { ascending: true });

  const points = locations.map(loc => ({
    lat: loc.latitude,
    lng: loc.longitude,
    timestamp: new Date(loc.timestamp).getTime(),
    accuracy: loc.accuracy
  }));

  const result = detectLocationAnomalies(points);
  
  if (result.isAnomalous && result.confidence > 0.7) {
    // Flag for review
    flagAgentForLocationAnomaly(agentId, result.reasons, result.confidence);
  }
}
```

## 5. Database Migration

Run the migration to create new tables:

```bash
supabase db push
```

This creates:
- `geofence_violations` table
- `location_anomalies` table
- `gps_tampering_attempts` table
- Extensions to `agent_live_locations` table

## 6. Admin Dashboard Queries

### Check for GPS tampering attempts
```sql
SELECT 
  agent_id,
  event_type,
  COUNT(*) as attempt_count,
  MAX(recorded_at) as latest_attempt
FROM gps_tampering_attempts
WHERE shift_date = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'
GROUP BY agent_id, event_type
ORDER BY attempt_count DESC;
```

### Check geofence violations
```sql
SELECT 
  g.agent_id,
  j.title as job_name,
  COUNT(*) as violation_count,
  ROUND(AVG(g.distance_from_site)::numeric) as avg_distance_meters
FROM geofence_violations g
JOIN service_jobs j ON g.job_id = j.id
WHERE g.recorded_at > NOW() - INTERVAL '7 days'
GROUP BY g.agent_id, j.title
ORDER BY violation_count DESC;
```

### Check location anomalies
```sql
SELECT 
  agent_id,
  anomaly_type,
  reasons,
  confidence,
  COUNT(*) as incident_count
FROM location_anomalies
WHERE detected_at > NOW() - INTERVAL '7 days'
GROUP BY agent_id, anomaly_type, reasons, confidence
ORDER BY confidence DESC;
```

## 7. Configuration Options

### Geofence Radius
In `useGeofenceValidator.ts`, line 35:
```typescript
const geofenceRadius = 150; // Change to desired meters
```

### Probe Intervals
In `FieldAgentGpsGuard.tsx`, lines 17-18:
```typescript
const PROBE_INTERVAL_MS = 15_000;        // Normal: 15 seconds
const AGGRESSIVE_PROBE_INTERVAL_MS = 5_000; // When GPS fails: 5 seconds
```

### Location Ping Frequency
In `useFieldAgentDuty.ts`, line 128:
```typescript
intervalRef.current = window.setInterval(pushPing, 30_000); // 30 seconds
```

### Anomaly Detection Sensitivity
In `locationAnomalyDetection.ts`:
- Adjust `maxHumanSpeed`, `maxVehicleSpeed` for your region
- Adjust confidence thresholds (0.5 = default)

## 8. Monitoring & Alerts

### Real-time Alerts
Create alert rules for:
- GPS disabled for >2 minutes
- Geofence violation
- Anomaly confidence >0.9 (likely spoofing)
- >3 consecutive probe failures

### Dashboard Widgets
- GPS Status: % agents with active GPS
- Violations: Agents outside job geofence
- Anomalies: Detected suspicious patterns
- Tampering: GPS disable attempts today

## 9. Testing

### Test GPS Blocking
1. Start the app as a field agent
2. Disable device GPS
3. Verify fullscreen alert appears within 15 seconds
4. Re-enable GPS
5. Verify alert clears

### Test Geofence
1. Create a job at known coordinates
2. Start job (should validate GPS)
3. Travel 200+ meters away
4. Verify geofence violation logged after 3-4 minutes

### Test Anomaly Detection
1. Manually insert test locations with impossible speeds
2. Wait 30 minutes (or manually trigger analysis)
3. Verify `location_anomalies` table gets populated

## 10. Troubleshooting

### "GPS is not supported on this device"
- Ensure device has location services
- Test with different browser (Chrome/Firefox work best)
- Check device security settings allow location access

### Geofence violations when agent IS at site
- Increase geofence radius (adjust `geofenceRadius` variable)
- Check GPS accuracy is < 50m
- Verify job location coordinates are correct

### Too many anomaly alerts
- Increase confidence threshold in analysis
- Reduce sensitivity of speed detection
- Adjust based on your agent's typical movement patterns

### Battery drain concerns
- 30-second pings are minimal (~1% battery/hour)
- Only aggressive probing (5s) uses more power
- Only triggered when GPS is disabled (temporary)

## 11. Privacy & Legal

⚠️ **Important**: Ensure compliance with:
- Local employment laws
- Employee privacy regulations
- Data protection regulations (GDPR, CCPA, etc.)
- Proper employee notification of tracking

Recommended disclosure:
> "Field agents' locations are tracked during duty hours for operational purposes and job verification. Location data is recorded server-side and retained for [X] days."

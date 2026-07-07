# GPS Tracking Architecture - System Overview

## Multi-Layer Defense System

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIELD AGENT APPLICATION                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 1: GPS PERMISSION ENFORCEMENT                      │  │
│  │ FieldAgentGpsGuard.tsx                                   │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • Probes GPS every 15 seconds (baseline)                │  │
│  │ • Switches to 5s probing on failure                     │  │
│  │ • Blocks entire UI with fullscreen modal                │  │
│  │ • Logs tampering attempts to server                     │  │
│  │ • Detection latency: 5-15 seconds                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ⬇                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 2: JOB START VALIDATION                            │  │
│  │ JobStartGpsValidator.tsx                                │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • Validates GPS before job start                        │  │
│  │ • Triple retry mechanism                                │  │
│  │ • Must have active fix to proceed                       │  │
│  │ • Blocks job assignment without GPS                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ⬇                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 3: CONTINUOUS LOCATION TRACKING                   │  │
│  │ useFieldAgentDuty.ts                                    │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • Captures location every 30 seconds                    │  │
│  │ • Records: lat, lng, accuracy, altitude, speed          │  │
│  │ • Maintains high-precision timestamp                    │  │
│  │ • Tracks km traveled with odometer                      │  │
│  │ • Blind spot: max 30 seconds                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ⬇                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 4: GEOFENCE ENFORCEMENT                           │  │
│  │ useGeofenceValidator.ts                                 │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • Validates agent within 150m of job site               │  │
│  │ • Checks every 60 seconds                               │  │
│  │ • 2-minute tolerance for minor departures               │  │
│  │ • Logs geofence violations                              │  │
│  │ • Detection latency: 3-4 minutes                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ⬇                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 5: ANOMALY DETECTION                              │  │
│  │ useLocationSpoofingDetector.ts                          │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • Analyzes last 30 minutes of locations                 │  │
│  │ • Runs anomaly detection every 5 minutes                │  │
│  │ • Detects impossible speeds (>60 km/h)                 │  │
│  │ • Detects spoofing patterns                             │  │
│  │ • Flags suspicious movement                            │  │
│  │ • Detection latency: 30 minutes                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          ⬇                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAYER 6: SERVER-SIDE PERSISTENCE                        │  │
│  │ Supabase Backend                                        │  │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │  │
│  │ • All data persisted in database                        │  │
│  │ • Cannot be deleted by agents                           │  │
│  │ • Immutable audit trail                                 │  │
│  │ • Admin-accessible for analysis                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────────────┐
│  GPS Chipset        │
│  (Hardware)         │
└──────────┬──────────┘
           │
           ⬇
┌─────────────────────────────────────────┐
│ Browser Geolocation API                 │
│ navigator.geolocation.watchPosition()   │
│ navigator.geolocation.getCurrentPosition()
└──────────┬──────────────────────────────┘
           │
     ┌─────┴─────┬──────────┬──────────────┐
     │            │          │              │
     ⬇            ⬇          ⬇              ⬇
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐
│ Guard   │ │ Duty    │ │ Geofence │ │ Spoofing     │
│ Probe   │ │ Ping    │ │ Check    │ │ Detector     │
│ (15s)   │ │ (30s)   │ │ (60s)    │ │ (5min)       │
└────┬────┘ └────┬────┘ └────┬─────┘ └───────┬──────┘
     │            │           │               │
     │ GPS Status │ Location  │ Violation     │ Anomaly
     │            │           │               │
     └────────────┴───────────┴───────────────┘
                  │
                  ⬇
        ┌─────────────────────┐
        │ Supabase (Server)    │
        └─────────────────────┘
                  │
        ┌─────────┴──────────────┬────────────┬─────────────┐
        │                        │            │             │
        ⬇                        ⬇            ⬇             ⬇
  ┌──────────────┐      ┌──────────────┐ ┌──────────┐ ┌──────────────┐
  │agent_live    │      │geofence_     │ │location_ │ │gps_tampering │
  │locations     │      │violations    │ │anomalies │ │_attempts     │
  │              │      │              │ │          │ │              │
  │lat, lng      │      │job_id        │ │reason[]  │ │event_type    │
  │accuracy      │      │distance      │ │confidence│ │failure_count │
  │speed         │      │recorded_at   │ │detected  │ │recorded_at   │
  │altitude      │      │              │ │_at       │ │              │
  │timestamp     │      │              │ │          │ │              │
  └──────────────┘      └──────────────┘ └──────────┘ └──────────────┘
```

## Evasion Prevention Matrix

```
┌──────────────────────┬─────────────────┬──────────────┬──────────┐
│ Evasion Method       │ Detection Layer │ Detection Time  Proof │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Disable GPS          │ Layer 1: Guard  │ 5-15 sec     │ Tampering│
│                      │                 │              │ Attempts │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Deny Permission      │ Layer 1: Guard  │ 5-15 sec     │ Tampering│
│                      │                 │              │ Attempts │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Leave Job Site       │ Layer 4: Geo    │ 3-4 min      │ Geofence │
│                      │                 │              │Violations│
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Spoof Location (App) │ Layer 5: Anom   │ 30 min       │ Anomaly  │
│                      │                 │              │ Detected │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Stay Stationary      │ Layer 5: Anom   │ 30+ min      │ No Mvmt  │
│                      │                 │              │ Pattern  │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Unrealistic Speed    │ Layer 5: Anom   │ 30 min       │ Speed    │
│                      │                 │              │ Anomaly  │
├──────────────────────┼─────────────────┼──────────────┼──────────┤
│ Clear Local Data     │ Layer 6: Server │ 0 sec        │ Server   │
│                      │                 │              │ Has Copy │
└──────────────────────┴─────────────────┴──────────────┴──────────┘
```

## Decision Tree: Is GPS Being Used?

```
                         START JOB?
                              │
                              ⬇
                   ┌───────────────────────┐
                   │ JobStartGpsValidator  │
                   │ Validate GPS Active?  │
                   └───────┬───────────────┘
                           │
                ┌──────────┴──────────┐
                ⬇                     ⬇
             YES               NO
              │                 │
              ⬇                 ⬇
         Allow Job      Show Error
         to Start       "Enable GPS"
              │                 │
              ⬇                 ⬇
        ┌──────────────┐   Job Blocked
        │ Job Active   │
        └────┬─────────┘
             │
             ⬇
   ┌─────────────────────┐
   │ Is Agent Still On   │
   │ Job Site? (Geo)     │
   └────┬───────────────┬┘
        │               │
      YES              NO
        │               │
        ⬇               ⬇
    Continue       Log Violation
     Job Work      Alert Manager
                   Force Return
```

## Performance Metrics

| Component | Frequency | Bandwidth | CPU | Battery |
|-----------|-----------|-----------|-----|---------|
| GPS Guard Probe | 15s baseline | ~100B | <1% | Minimal |
| Location Ping | 30s | ~500B | <1% | ~1% |
| Geofence Check | 60s | ~100B | <1% | Minimal |
| Spoofing Analysis | 300s | ~50KB | 2-3% | <1% |
| **Total Impact** | - | **~6KB/min** | **<5%** | **~1-2%** |

## Resilience Features

### Redundancy
- Multiple detection layers (6 independent systems)
- Fallback to next layer if one fails
- Server-side validation can catch any client-side bypass

### Robustness
- Aggressive retry on GPS failures
- Offline detection (app blocks on offline)
- Graceful degradation if GPS unavailable

### Auditability
- Immutable server-side logs
- Complete timestamp tracking
- RLS policies prevent tampering
- Admin-only visibility into anomalies

## Integration Points

```
App Startup
    ⬇
FieldAgentDashboard
    ├─ FieldAgentGpsGuard (always active)
    ├─ useFieldAgentDuty (tracks duty)
    └─ useLocationSpoofingDetector (analyzes patterns)
    ⬇
Job Available
    ⬇
JobCard / JobStartModal
    ├─ JobStartGpsValidator (validates)
    └─ Geolocation Callback (captures position)
    ⬇
Job Started
    ⬇
ActiveJobDisplay
    ├─ useGeofenceValidator (monitors)
    └─ Real-time Location Tracking
    ⬇
Job Completed/Duty Ends
    ⬇
Tracking Stops
    └─ Data Persisted in Server
```

## Attack Surface Reduction

| Attack Vector | Protection | Level |
|---|---|---|
| Disable GPS | Multi-layer detection | 🟢 Excellent |
| Clear local cache | Server-side persistence | 🟢 Excellent |
| Spoof GPS data | Anomaly detection | 🟡 Good |
| Clock manipulation | Server-side timestamps | 🟢 Excellent |
| App manipulation | Multiple independent checks | 🟡 Good |
| Network interception | HTTPS/TLS encryption | 🟢 Excellent |
| Permission bypass | OS-level enforcement | 🟢 Excellent |
| Offline bypass | Online-required blocks | 🟢 Excellent |

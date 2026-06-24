import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin } from "lucide-react";
import { useData } from "@/contexts/DataContext";
import type { ServiceJobStatus } from "@/contexts/DataContext";

// Fix default icon paths (Leaflet + bundlers)
const makeIcon = (color: string) =>
  L.divIcon({
    className: "agent-pin",
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px ${color}66, 0 2px 6px rgba(0,0,0,0.35)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const LOST_COLOR = "#9ca3af";
const ACTIVE_JOB_STATUSES = ["assigned", "on_route", "on_site", "in_progress"] as const;

interface Ping {
  agent_id: string;
  agent_name: string;
  latitude: number;
  longitude: number;
  captured_at: string;
}

interface ActiveJob {
  assigned_agent: string | null;
  status: ServiceJobStatus;
  customer_name: string;
  address: string;
  location_lat: number | null;
  location_lng: number | null;
  updated_at: string;
}

interface TrackedAgent {
  agent_id: string;
  agent_name: string;
  latitude: number | null;
  longitude: number | null;
  captured_at: string | null;
  hasLivePing: boolean;
  job_status?: string;
  job_customer?: string;
  job_address?: string;
  job_updated_at?: string;
}

const istToday = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
};

const timeAgo = (iso: string) => {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

interface SignalLog {
  id: string;
  agent_id: string;
  agent_name: string | null;
  event_type: string;
  occurred_at: string;
  duration_minutes: number | null;
}

const LiveTracking = () => {
  const { profiles } = useData();
  const [latest, setLatest] = useState<TrackedAgent[]>([]);
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const fetchLatest = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: pings }, { data: jobs }, { data: logs }] = await Promise.all([
      supabase
        .from("agent_live_locations")
        .select("agent_id, agent_name, latitude, longitude, captured_at")
        .eq("shift_date", istToday())
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .limit(500),
      supabase
        .from("service_jobs")
        .select("assigned_agent, status, customer_name, address, location_lat, location_lng, updated_at")
        .is("deleted_at", null)
        .not("assigned_agent", "is", null)
        .in("status", ACTIVE_JOB_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("agent_signal_logs")
        .select("id, agent_id, agent_name, event_type, occurred_at, duration_minutes")
        .eq("shift_date", istToday())
        .order("occurred_at", { ascending: false })
        .limit(500),
    ]);

    const byAgent = new Map<string, Ping>();
    (pings as Ping[] | null)?.forEach((p) => {
      if (!byAgent.has(p.agent_id)) byAgent.set(p.agent_id, p);
    });

    const activeByAgent = new Map<string, ActiveJob>();
    (jobs as ActiveJob[] | null)?.forEach((job) => {
      if (job.assigned_agent && !activeByAgent.has(job.assigned_agent)) activeByAgent.set(job.assigned_agent, job);
    });

    const agentIds = new Set([...byAgent.keys(), ...activeByAgent.keys()]);
    const tracked = Array.from(agentIds).map((agentId) => {
      const ping = byAgent.get(agentId);
      const job = activeByAgent.get(agentId);
      const profile = profiles.find((p) => p.id === agentId);
      return {
        agent_id: agentId,
        agent_name: ping?.agent_name || profile?.name || "Field Agent",
        latitude: ping?.latitude ?? job?.location_lat ?? null,
        longitude: ping?.longitude ?? job?.location_lng ?? null,
        captured_at: ping?.captured_at ?? null,
        hasLivePing: !!ping,
        job_status: job?.status,
        job_customer: job?.customer_name,
        job_address: job?.address,
        job_updated_at: job?.updated_at,
      } satisfies TrackedAgent;
    });

    setLatest(tracked);
    setSignalLogs((logs as SignalLog[] | null) ?? []);
    setLoading(false);
  }, [profiles]);

  useEffect(() => {
    fetchLatest();
    const i = window.setInterval(fetchLatest, 60_000);
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000); // refresh "x min ago"
    return () => {
      window.clearInterval(i);
      window.clearInterval(t);
    };
  }, [fetchLatest]);

  const SIGNAL_LOST_MIN = 10;
  const isStale = (p: TrackedAgent) => {
    const ageMin = p.captured_at ? (Date.now() - new Date(p.captured_at).getTime()) / 60000 : Infinity;
    return !p.hasLivePing || ageMin > SIGNAL_LOST_MIN;
  };

  const eventLabel = (t: string) => {
    const map: Record<string, string> = {
      gps_off: "GPS Off",
      gps_restored: "GPS Restored",
      offline: "Offline",
      online: "Online",
      signal_lost: "Signal Lost",
      signal_restored: "Signal Restored",
    };
    return map[t] || t;
  };
  const eventClass = (t: string) =>
    ["gps_off", "offline", "signal_lost"].includes(t)
      ? "text-destructive"
      : "text-success";


  const center = useMemo<[number, number]>(() => {
    const mapped = latest.filter((p) => p.latitude != null && p.longitude != null);
    if (mapped.length === 0) return [28.6139, 77.209]; // Delhi default
    const avgLat = mapped.reduce((s, p) => s + Number(p.latitude), 0) / mapped.length;
    const avgLng = mapped.reduce((s, p) => s + Number(p.longitude), 0) / mapped.length;
    return [avgLat, avgLng];
  }, [latest]);

  const mappedAgents = latest.filter((p) => p.latitude != null && p.longitude != null);

  const colorFor = (id: string, idx: number, stale: boolean) =>
    stale ? LOST_COLOR : COLORS[idx % COLORS.length];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="w-6 h-6 text-primary" /> Live Tracking
        </h1>
        <p className="text-sm text-muted-foreground">
          Field agent locations refresh automatically every 60 seconds. Pins go grey after 5 minutes of silence.
        </p>
      </div>

      <Card className="overflow-hidden" style={{ height: 520 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <MapContainer center={center} zoom={11} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mappedAgents.map((p, idx) => {
              const ageMin = p.captured_at ? (Date.now() - new Date(p.captured_at).getTime()) / 60000 : Infinity;
              const stale = !p.hasLivePing || ageMin > 5;
              return (
                <Marker
                  key={p.agent_id}
                  position={[Number(p.latitude), Number(p.longitude)]}
                  icon={makeIcon(colorFor(p.agent_id, idx, stale))}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">{p.agent_name}</div>
                      <div className="text-muted-foreground">
                        {stale ? "Signal Lost" : `Updated ${timeAgo(p.captured_at!)}`}
                      </div>
                      {p.job_customer && <div>Job: {p.job_customer}</div>}
                      {p.job_status && <div className="capitalize">Status: {p.job_status.replace("_", " ")}</div>}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Tracked agents ({latest.length})</h2>
        {latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active assigned/en-route agents found yet.</p>
        ) : (
          <ul className="space-y-2">
            {latest.map((p, idx) => {
              const ageMin = p.captured_at ? (Date.now() - new Date(p.captured_at).getTime()) / 60000 : Infinity;
              const stale = !p.hasLivePing || ageMin > 5;
              return (
                <li key={p.agent_id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full mt-1"
                      style={{ background: colorFor(p.agent_id, idx, stale) }}
                    />
                    <div>
                      <div className="font-medium">{p.agent_name}</div>
                      {p.job_customer && <div className="text-xs text-muted-foreground">{p.job_customer}</div>}
                      {p.job_address && <div className="text-xs text-muted-foreground line-clamp-1">{p.job_address}</div>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {p.job_status && <Badge variant="outline" className="capitalize">{p.job_status.replace("_", " ")}</Badge>}
                    {stale ? (
                      <Badge variant="secondary">Signal Lost</Badge>
                    ) : (
                      <div className="text-muted-foreground">Updated {timeAgo(p.captured_at!)}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default LiveTracking;

import { useState, useEffect, useMemo } from "react";
import { useData } from "@/contexts/DataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Clock, ShieldAlert, RefreshCw, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AuditFlag {
  id: string;
  job_id: string | null;
  agent_id: string;
  flag_type: string;
  description: string;
  severity: string;
  resolved: boolean;
  created_at: string;
}

const AuditDashboard = () => {
  const { serviceJobs, profiles, getProfilesByRole } = useData();
  const [flags, setFlags] = useState<AuditFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [scanning, setScanning] = useState(false);

  const fieldAgents = getProfilesByRole("field_agent");

  const fetchFlags = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("audit_flags")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100) as { data: AuditFlag[] | null };
    setFlags(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchFlags(); }, []);

  // Run audit scan on current data
  const runAuditScan = async () => {
    setScanning(true);
    const newFlags: Omit<AuditFlag, "id" | "created_at">[] = [];

    for (const job of serviceJobs) {
      if (job.status !== "completed" || !job.assigned_agent) continue;

      // 1. Quick completion check (< 5 min between accepted and completed)
      if (job.accepted_at && job.completed_at) {
        const acceptedMs = new Date(job.accepted_at).getTime();
        const completedMs = new Date(job.completed_at).getTime();
        const diffMin = (completedMs - acceptedMs) / 60000;
        if (diffMin < 5 && diffMin >= 0) {
          newFlags.push({
            job_id: job.id,
            agent_id: job.assigned_agent,
            flag_type: "quick_completion",
            description: `Completed in ${Math.round(diffMin)} min (${job.customer_name})`,
            severity: "warning",
            resolved: false,
          });
        }
      }

      // 2. No photos check
      if (!job.photos || job.photos.length === 0 || (job.photos.length === 1 && job.photos[0] === "")) {
        newFlags.push({
          job_id: job.id,
          agent_id: job.assigned_agent,
          flag_type: "no_photos",
          description: `No photos uploaded for ${job.customer_name}`,
          severity: "warning",
          resolved: false,
        });
      }
    }

    // 3. Repeated reschedules check
    const { data: reschedules } = await supabase
      .from("reschedule_history")
      .select("job_id, rescheduled_by");

    if (reschedules) {
      const jobCounts: Record<string, { count: number; agent: string }> = {};
      for (const r of reschedules) {
        if (!jobCounts[r.job_id]) jobCounts[r.job_id] = { count: 0, agent: r.rescheduled_by };
        jobCounts[r.job_id].count++;
      }
      for (const [jobId, info] of Object.entries(jobCounts)) {
        if (info.count >= 2) {
          const job = serviceJobs.find(j => j.id === jobId);
          newFlags.push({
            job_id: jobId,
            agent_id: info.agent,
            flag_type: "delay_pattern",
            description: `Rescheduled ${info.count} times (${job?.customer_name || "Unknown"})`,
            severity: info.count >= 3 ? "critical" : "warning",
            resolved: false,
          });
        }
      }
    }

    // 4. Late acceptance check (> 10 min after assignment)
    for (const job of serviceJobs) {
      if (!job.assigned_agent || !job.accepted_at) continue;
      const createdMs = new Date(job.created_at).getTime();
      const acceptedMs = new Date(job.accepted_at).getTime();
      const diffMin = (acceptedMs - createdMs) / 60000;
      if (diffMin > 10) {
        newFlags.push({
          job_id: job.id,
          agent_id: job.assigned_agent,
          flag_type: "late_start",
          description: `Accepted ${Math.round(diffMin)} min after assignment (${job.customer_name})`,
          severity: "info",
          resolved: false,
        });
      }
    }

    // Deduplicate: skip flags that already exist for same job_id + flag_type
    const existingKeys = new Set(flags.map(f => `${f.job_id}-${f.flag_type}`));
    const uniqueFlags = newFlags.filter(f => !existingKeys.has(`${f.job_id}-${f.flag_type}`));

    if (uniqueFlags.length > 0) {
      const { error } = await supabase.from("audit_flags").insert(uniqueFlags as any);
      if (error) {
        toast.error("Failed to save audit flags");
      } else {
        toast.success(`Found ${uniqueFlags.length} new flags`);
        await fetchFlags();
      }
    } else {
      toast.info("No new issues found");
    }
    setScanning(false);
  };

  const resolveFlag = async (id: string) => {
    await supabase.from("audit_flags").update({ resolved: true } as any).eq("id", id);
    setFlags(prev => prev.map(f => f.id === id ? { ...f, resolved: true } : f));
    toast.success("Flag resolved");
  };

  const filteredFlags = useMemo(() => {
    let result = flags;
    if (agentFilter !== "all") result = result.filter(f => f.agent_id === agentFilter);
    if (typeFilter !== "all") result = result.filter(f => f.flag_type === typeFilter);
    return result;
  }, [flags, agentFilter, typeFilter]);

  // Compute agent scores from current data
  const agentScores = useMemo(() => {
    return fieldAgents.map(agent => {
      const jobs = serviceJobs.filter(j => j.assigned_agent === agent.id);
      const completed = jobs.filter(j => j.status === "completed");
      const onTime = completed.filter(j => {
        if (!j.date_to_attend || !j.completed_at) return true;
        return new Date(j.completed_at).toISOString().split("T")[0] <= j.date_to_attend;
      });
      const agentFlags = flags.filter(f => f.agent_id === agent.id && !f.resolved);
      const reschedules = jobs.filter(j => j.status === "rescheduled").length;

      const onTimePct = completed.length ? Math.round((onTime.length / completed.length) * 100) : 100;
      // Score: base 100, -5 per flag, -3 per reschedule, weighted by on-time %
      const score = Math.max(0, Math.min(100,
        Math.round(onTimePct * 0.5 + (completed.length > 0 ? 30 : 0) - agentFlags.length * 5 - reschedules * 3 + 20)
      ));

      return {
        agent,
        score,
        jobsCompleted: completed.length,
        onTimePct,
        rescheduleCount: reschedules,
        flagsCount: agentFlags.length,
      };
    }).sort((a, b) => b.score - a.score);
  }, [fieldAgents, serviceJobs, flags]);

  const severityIcon = (severity: string) => {
    if (severity === "critical") return <ShieldAlert className="w-4 h-4 text-destructive" />;
    if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-warning" />;
    return <Clock className="w-4 h-4 text-muted-foreground" />;
  };

  const scoreColor = (score: number) => {
    if (score >= 90) return "bg-success/10 text-success";
    if (score >= 70) return "bg-warning/10 text-warning";
    return "bg-destructive/10 text-destructive";
  };

  const scoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 70) return "Good";
    return "Needs Attention";
  };

  return (
    <div className="space-y-4">
      {/* Agent Performance Scores */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" />Agent Performance Scores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {agentScores.map(as => (
              <div key={as.agent.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                  {as.agent.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{as.agent.name}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <span>Done: {as.jobsCompleted}</span>
                    <span>On-time: {as.onTimePct}%</span>
                    <span>Reschedules: {as.rescheduleCount}</span>
                    <span>Flags: {as.flagsCount}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold">{as.score}</p>
                  <Badge className={scoreColor(as.score)}>{scoreLabel(as.score)}</Badge>
                </div>
              </div>
            ))}
            {agentScores.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No field agents found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit Flags */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />Audit Alerts ({filteredFlags.filter(f => !f.resolved).length} active)
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={fetchFlags} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button size="sm" onClick={runAuditScan} disabled={scanning} className="gap-1">
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              Scan Now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Issue Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="quick_completion">Quick Completion</SelectItem>
                <SelectItem value="no_photos">No Photos</SelectItem>
                <SelectItem value="delay_pattern">Delay Pattern</SelectItem>
                <SelectItem value="late_start">Late Start</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Time</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFlags.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No audit flags. Click "Scan Now" to check.</TableCell></TableRow>
              )}
              {filteredFlags.map(f => (
                <TableRow key={f.id} className={f.resolved ? "opacity-50" : ""}>
                  <TableCell>{severityIcon(f.severity)}</TableCell>
                  <TableCell className="font-medium">{profiles.find(p => p.id === f.agent_id)?.name || "Unknown"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{f.flag_type.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{f.description}</TableCell>
                  <TableCell className="text-xs">{new Date(f.created_at).toLocaleString("en-IN")}</TableCell>
                  <TableCell>
                    {!f.resolved && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => resolveFlag(f.id)}>
                        Resolve
                      </Button>
                    )}
                    {f.resolved && <Badge className="bg-success/10 text-success">Resolved</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditDashboard;

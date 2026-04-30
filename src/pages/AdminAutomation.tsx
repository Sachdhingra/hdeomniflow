import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlayCircle, MessageSquare, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

type StageRow = { stage: string; count: number; avg_days: number };
type LogRow = { id: string; event_type: string; success: boolean; details: any; error_message: string | null; executed_at: string; lead_id: string | null };
type MsgRow = { id: string; lead_id: string; message_type: string; trigger_stage: string; status: string; created_at: string; sent_at: string | null; error_message: string | null };

const STAGES = ["new", "contacted", "follow_up", "negotiation", "overdue"] as const;
type ActiveStage = typeof STAGES[number];

const AdminAutomation = () => {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [counts, setCounts] = useState({ pending: 0, sent_today: 0, failed_today: 0, queued_today: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const { data: leads } = await supabase
        .from("leads")
        .select("status, stage_changed_at, created_at")
        .is("deleted_at", null)
        .in("status", STAGES);

      const map: Record<string, { count: number; total_days: number }> = {};
      STAGES.forEach(s => { map[s] = { count: 0, total_days: 0 }; });
      const now = Date.now();
      (leads ?? []).forEach(l => {
        const ref = new Date(l.stage_changed_at ?? l.created_at).getTime();
        const days = Math.floor((now - ref) / 86400000);
        if (map[l.status]) {
          map[l.status].count++;
          map[l.status].total_days += days;
        }
      });
      setStages(STAGES.map(s => ({
        stage: s,
        count: map[s].count,
        avg_days: map[s].count ? Math.round(map[s].total_days / map[s].count) : 0,
      })));

      const { data: logsData } = await supabase
        .from("automation_logs")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(30);
      setLogs((logsData ?? []) as LogRow[]);

      const { data: msgsData } = await supabase
        .from("auto_nurture_messages")
        .select("id, lead_id, message_type, trigger_stage, status, created_at, sent_at, error_message")
        .order("created_at", { ascending: false })
        .limit(50);
      setMsgs((msgsData ?? []) as MsgRow[]);

      const { count: pendingCount } = await supabase
        .from("auto_nurture_messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      const { count: sentToday } = await supabase
        .from("auto_nurture_messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("sent_at", todayIso);
      const { count: failedToday } = await supabase
        .from("auto_nurture_messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", todayIso);
      const { count: queuedToday } = await supabase
        .from("auto_nurture_messages")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayIso);

      setCounts({
        pending: pendingCount ?? 0,
        sent_today: sentToday ?? 0,
        failed_today: failedToday ?? 0,
        queued_today: queuedToday ?? 0,
      });
    } catch (e: any) {
      toast.error(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("nurture-engine");
      if (error) throw error;
      toast.success(`Engine ran: ${data?.queued ?? 0} queued, ${data?.scored ?? 0} scored, ${data?.moved_to_overdue ?? 0} → overdue`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Engine failed");
    } finally {
      setRunning(false);
    }
  };

  const sendReportNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-excel-report");
      if (error) throw error;
      toast.success(`Daily report sent: ${data?.sent ?? 0}/${data?.total ?? 0} recipients`);
    } catch (e: any) {
      toast.error(e.message || "Report failed");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Automation Monitor</h1>
          <p className="text-sm text-muted-foreground">Autonomous nurture engine — daily scoring, stage moves, and message queue.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={sendReportNow} disabled={running} variant="outline" className="gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
            Send daily report now
          </Button>
          <Button onClick={runNow} disabled={running} className="gradient-primary gap-2">
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run engine now
          </Button>
        </div>
      </div>
          <p className="text-sm text-muted-foreground">Autonomous nurture engine — daily scoring, stage moves, and message queue.</p>
        </div>
        <Button onClick={runNow} disabled={running} className="gradient-primary gap-2">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          Run engine now
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><Clock className="w-3.5 h-3.5" />Queued (pending)</div>
          <p className="text-2xl font-bold mt-1">{counts.pending}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><MessageSquare className="w-3.5 h-3.5" />Queued today</div>
          <p className="text-2xl font-bold mt-1">{counts.queued_today}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><CheckCircle2 className="w-3.5 h-3.5" />Sent today</div>
          <p className="text-2xl font-bold mt-1 text-success">{counts.sent_today}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs"><AlertTriangle className="w-3.5 h-3.5" />Failed today</div>
          <p className="text-2xl font-bold mt-1 text-destructive">{counts.failed_today}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Leads by stage</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Stage</TableHead><TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Avg days in stage</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {stages.map(s => (
                <TableRow key={s.stage}>
                  <TableCell className="capitalize">{s.stage.replace("_", " ")}</TableCell>
                  <TableCell className="text-right font-medium">{s.count}</TableCell>
                  <TableCell className="text-right">{s.avg_days}d</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent automation log</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-96 overflow-y-auto">
          {logs.length === 0 && <p className="text-sm text-muted-foreground">No log entries yet. Click "Run engine now" to trigger.</p>}
          {logs.map(l => (
            <div key={l.id} className="flex items-start gap-2 text-sm border-l-2 pl-3 py-1" style={{ borderColor: l.success ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
              <Badge variant={l.success ? "secondary" : "destructive"} className="text-[10px] shrink-0">{l.event_type}</Badge>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{new Date(l.executed_at).toLocaleString()}</p>
                {l.error_message && <p className="text-xs text-destructive">{l.error_message}</p>}
                {l.details && <pre className="text-[11px] text-muted-foreground truncate">{JSON.stringify(l.details)}</pre>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent messages queued</CardTitle></CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Type</TableHead><TableHead>Stage</TableHead>
                <TableHead>Status</TableHead><TableHead>Created</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {msgs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-6">No messages queued yet.</TableCell></TableRow>}
                {msgs.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs font-mono">{m.message_type}</TableCell>
                    <TableCell className="text-xs capitalize">{m.trigger_stage.replace("_", " ")}</TableCell>
                    <TableCell>
                      <Badge variant={m.status === "sent" ? "secondary" : m.status === "failed" ? "destructive" : "outline"} className="text-[10px]">
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAutomation;

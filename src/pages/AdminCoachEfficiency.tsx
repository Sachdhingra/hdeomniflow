import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import {
  checkinStats,
  dailyResponse,
  formatDuration,
  istMidnightMs,
  longestQuietStretch,
  median,
  rangeFor,
  signalsFor,
  type CoachMsgRow,
  type RangeKey,
  type Signal,
} from "@/lib/coachEfficiency";

// The coach tables are newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const PAGE = 1000;

// PostgREST returns at most 1000 rows per request — page through everything.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
];

interface RepRow {
  id: string;
  name: string;
  coachOn: boolean;
  sent: number;
  replied: number;
  responseRate: number | null;
  medianReplyMinutes: number | null;
  actionsApplied: number;
  presentDays: number;
  lateDays: number;
  presentToday: boolean;
  leadsTouched: number;
  leadsCreated: number;
  stageMoves: number;
  overdue: number;
  quietMinutes: number | null;
  lastActivityMs: number | null;
  monthWon: number;
  monthTarget: number | null;
  signals: Signal[];
}

interface Report {
  reps: RepRow[];
  daily: { date: string; sent: number; replied: number; rate: number | null }[];
  teamResponseRate: number | null;
  teamMedianReply: number | null;
  actionsApplied: number;
  overdue: number;
  presentToday: number;
  coachOn: number;
  generatedAt: number;
}

const inr = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)} Cr` : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

// Concerns are amber, praise is green — never alarm-red for a coaching signal.
// Each carries an icon as well as a label, so meaning never rests on colour alone.
const SIGNAL_STYLE: Record<Signal["tone"], string> = {
  warn: "border-amber-500/50 bg-amber-50 text-amber-900",
  info: "border-emerald-500/50 bg-emerald-50 text-emerald-900",
};

const timeIST = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

async function buildReport(reps: { id: string; name: string }[], rangeKey: RangeKey): Promise<Report> {
  const now = new Date();
  const r = rangeFor(rangeKey, now);
  const ids = reps.map(x => x.id);
  const fromIso = new Date(r.fromMs).toISOString();
  const month = r.today.slice(0, 7);
  const monthStartMs = istMidnightMs(`${month}-01`);

  const [msgs, attendance, stages, touched, created, overdueRows, wonRows, targets] = await Promise.all([
    fetchAll<CoachMsgRow>((a, b) =>
      db.from("staff_agent_messages").select("user_id,sender,kind,created_at,actions").in("user_id", ids)
        .gte("created_at", fromIso).order("created_at", { ascending: true }).range(a, b)),
    fetchAll<{ user_id: string; date: string; clock_in: string | null; clock_out: string | null; status: string }>((a, b) =>
      db.from("attendance").select("user_id,date,clock_in,clock_out,status").in("user_id", ids)
        .gte("date", r.fromDate).lte("date", r.toDate).range(a, b)),
    fetchAll<{ changed_by_id: string; changed_at: string }>((a, b) =>
      db.from("lead_stage_history").select("changed_by_id,changed_at").in("changed_by_id", ids)
        .gte("changed_at", fromIso).range(a, b)),
    fetchAll<{ updated_by: string; updated_at: string }>((a, b) =>
      db.from("leads").select("updated_by,updated_at").in("updated_by", ids).is("deleted_at", null)
        .gte("updated_at", fromIso).range(a, b)),
    fetchAll<{ created_by: string; created_at: string }>((a, b) =>
      db.from("leads").select("created_by,created_at").in("created_by", ids).is("deleted_at", null)
        .gte("created_at", fromIso).range(a, b)),
    fetchAll<{ assigned_to: string }>((a, b) =>
      db.from("leads").select("assigned_to").in("assigned_to", ids).is("deleted_at", null)
        .not("status", "in", "(won,lost)").lt("next_follow_up_date", r.today).range(a, b)),
    fetchAll<{ assigned_to: string; value_in_rupees: number }>((a, b) =>
      db.from("leads").select("assigned_to,value_in_rupees").in("assigned_to", ids).is("deleted_at", null)
        .eq("status", "won").gte("updated_at", new Date(monthStartMs).toISOString()).range(a, b)),
    fetchAll<{ user_id: string; target_value: number }>((a, b) =>
      db.from("sales_targets").select("user_id,target_value").eq("month", month).in("user_id", ids).range(a, b)),
  ]);

  const msgsByUser = new Map<string, CoachMsgRow[]>();
  msgs.forEach(m => msgsByUser.set(m.user_id, [...(msgsByUser.get(m.user_id) ?? []), m]));

  const todayStartMs = istMidnightMs(r.today);
  const workStartMs = todayStartMs + 11 * 3_600_000;
  const workEndMs = todayStartMs + 20 * 3_600_000;

  const rows: RepRow[] = reps.map(rep => {
    const mine = msgsByUser.get(rep.id) ?? [];
    const cs = checkinStats(mine, r.fromMs, r.toMs);
    const att = attendance.filter(a => a.user_id === rep.id && a.clock_in);
    const todayAtt = att.find(a => a.date === r.today);
    const presentToday = !!todayAtt && !todayAtt.clock_out;

    const myStages = stages.filter(s => s.changed_by_id === rep.id);
    const myTouched = touched.filter(t => t.updated_by === rep.id);

    // Quiet stretch today, from CRM activity: stage moves, lead updates, and the
    // rep's own replies to the coach. Only for someone clocked in today.
    let quietMinutes: number | null = null;
    let lastActivityMs: number | null = null;
    if (todayAtt?.clock_in) {
      const today = (iso: string) => Date.parse(iso) >= todayStartMs;
      const events = [
        ...myStages.filter(s => today(s.changed_at)).map(s => Date.parse(s.changed_at)),
        ...myTouched.filter(t => today(t.updated_at)).map(t => Date.parse(t.updated_at)),
        ...mine.filter(m => m.sender === "staff" && today(m.created_at)).map(m => Date.parse(m.created_at)),
      ];
      lastActivityMs = events.length ? Math.max(...events) : null;
      const start = Math.max(workStartMs, Date.parse(todayAtt.clock_in));
      const end = Math.min(todayAtt.clock_out ? Date.parse(todayAtt.clock_out) : now.getTime(), workEndMs);
      quietMinutes = longestQuietStretch(events, start, end)?.minutes ?? null;
    }

    // Reply outcome of the two most recent check-ins, for the "not replying" flag.
    const checkins = mine.filter(m => m.kind === "checkin" && m.sender === "agent");
    const last2 = checkins.slice(-2);
    const recent = last2.length
      ? checkinStats(mine, Date.parse(last2[0].created_at), Date.parse(last2[last2.length - 1].created_at) + 1)
      : { sent: 0, replied: 0 };

    const overdue = overdueRows.filter(o => o.assigned_to === rep.id).length;
    const target = targets.find(t => t.user_id === rep.id);
    const row: RepRow = {
      id: rep.id,
      name: rep.name,
      coachOn: checkins.length > 0,
      sent: cs.sent,
      replied: cs.replied,
      responseRate: cs.responseRate,
      medianReplyMinutes: cs.medianReplyMinutes,
      actionsApplied: cs.actionsApplied,
      presentDays: att.length,
      lateDays: att.filter(a => a.status === "late").length,
      presentToday,
      leadsTouched: myTouched.length,
      leadsCreated: created.filter(c => c.created_by === rep.id).length,
      stageMoves: myStages.length,
      overdue,
      quietMinutes,
      lastActivityMs,
      monthWon: wonRows.filter(w => w.assigned_to === rep.id).reduce((n, w) => n + Number(w.value_in_rupees || 0), 0),
      monthTarget: target ? Number(target.target_value) : null,
      signals: [],
    };
    row.signals = signalsFor({
      coachOn: row.coachOn,
      checkinsSent: row.sent,
      responseRate: row.responseRate,
      recentCheckinsSent: recent.sent,
      recentCheckinsReplied: recent.replied,
      overdueFollowUps: row.overdue,
      quietMinutesToday: row.quietMinutes,
      presentToday: row.presentToday,
    });
    return row;
  });

  const sent = rows.reduce((n, x) => n + x.sent, 0);
  const replied = rows.reduce((n, x) => n + x.replied, 0);
  const allReplyMinutes: number[] = [];
  rows.forEach(x => x.medianReplyMinutes !== null && allReplyMinutes.push(x.medianReplyMinutes));
  return {
    reps: rows,
    daily: dailyResponse(msgsByUser, r.fromDate, r.days),
    teamResponseRate: sent > 0 ? Math.round((replied / sent) * 100) : null,
    teamMedianReply: median(allReplyMinutes),
    actionsApplied: rows.reduce((n, x) => n + x.actionsApplied, 0),
    overdue: rows.reduce((n, x) => n + x.overdue, 0),
    presentToday: rows.filter(x => x.presentToday).length,
    coachOn: rows.filter(x => x.coachOn).length,
    generatedAt: now.getTime(),
  };
}

// ── presentation ────────────────────────────────────────────────────────────
const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </CardContent>
  </Card>
);

interface DayPoint { date: string; sent: number; replied: number; rate: number | null }

const ChartTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: DayPoint }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-md">
      <div className="text-lg font-semibold tabular-nums">{d.rate === null ? "No check-ins" : `${d.rate}%`}</div>
      <div className="text-xs text-muted-foreground">{dayLabel(d.date)}</div>
      <div className="text-xs text-muted-foreground">{d.replied} replied of {d.sent} check-ins</div>
    </div>
  );
};

const AdminCoachEfficiency = () => {
  const { user, allProfiles } = useAuth();
  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  const reps = useMemo(
    () => allProfiles.filter(p => p.role === "sales").map(p => ({ id: p.id, name: p.name })),
    [allProfiles],
  );
  const repKey = reps.map(x => x.id).join(",");

  const load = useCallback(async () => {
    if (reps.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setReport(await buildReport(reps, rangeKey));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the report");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repKey, rangeKey]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user || user.role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">Coach Efficiency unavailable</h1>
        <p className="text-muted-foreground">This dashboard is for admins only.</p>
      </div>
    );
  }

  const sorted = report
    ? [...report.reps].sort((a, b) => Number(b.coachOn) - Number(a.coachOn) || (b.responseRate ?? -1) - (a.responseRate ?? -1) || a.name.localeCompare(b.name))
    : [];
  const chartData = report?.daily ?? [];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[16rem]">
          <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Coach Efficiency</h1>
            <p className="text-xs text-muted-foreground">
              How the sales team is using OmniFlow and their coach. Signals come from CRM activity and are approximate —
              use them to help, not to judge.
            </p>
          </div>
        </div>
        <Select value={rangeKey} onValueChange={v => setRangeKey(v as RangeKey)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map(x => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Refresh">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      {!report && loading && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-muted-foreground" />}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile
              label="Check-in response rate"
              value={report.teamResponseRate === null ? "—" : `${report.teamResponseRate}%`}
              hint={`${report.coachOn} of ${report.reps.length} reps have the coach`}
            />
            <Tile
              label="Typical reply time"
              value={report.teamMedianReply === null ? "—" : formatDuration(report.teamMedianReply)}
              hint="median across reps"
            />
            <Tile label="Saved by the coach" value={String(report.actionsApplied)} hint="notes & follow-ups from chat" />
            <Tile label="Overdue follow-ups" value={String(report.overdue)} hint="open leads, team total, now" />
            <Tile label="Present today" value={`${report.presentToday} / ${report.reps.length}`} hint="clocked in, not out" />
          </div>

          {rangeKey !== "today" && (
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Daily check-in response rate</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowTable(s => !s)}>
                  {showTable ? "Show chart" : "Show as table"}
                </Button>
              </CardHeader>
              <CardContent>
                {showTable ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead className="text-right">Check-ins</TableHead>
                        <TableHead className="text-right">Replied</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chartData.map(d => (
                        <TableRow key={d.date}>
                          <TableCell>{dayLabel(d.date)}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.sent}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.replied}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.rate === null ? "—" : `${d.rate}%`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div
                    className="h-56 coach-eff-chart"
                    role="img"
                    aria-label={`Daily check-in response rate, ${chartData.length} days. Use "Show as table" for the exact numbers.`}
                  >
                    <style>{`
                      .coach-eff-chart { --coach-series: #2a78d6; --coach-grid: hsl(var(--border)); --coach-ink: hsl(var(--muted-foreground)); }
                      .dark .coach-eff-chart { --coach-series: #3987e5; }
                    `}</style>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid vertical={false} stroke="var(--coach-grid)" strokeOpacity={0.6} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={dayLabel}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--coach-ink)", fontSize: 11 }}
                          interval={chartData.length > 10 ? Math.ceil(chartData.length / 8) - 1 : 0}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 25, 50, 75, 100]}
                          tickFormatter={v => `${v}%`}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--coach-ink)", fontSize: 11 }}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--coach-grid)", fillOpacity: 0.25 }} />
                        <Bar dataKey="rate" fill="var(--coach-series)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By salesperson</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rep</TableHead>
                      <TableHead>Signals</TableHead>
                      <TableHead className="text-right">Check-ins replied</TableHead>
                      <TableHead className="text-right">Reply time</TableHead>
                      <TableHead className="text-right">Days present</TableHead>
                      <TableHead className="text-right">Leads touched</TableHead>
                      <TableHead className="text-right">Stage moves</TableHead>
                      <TableHead className="text-right">New leads</TableHead>
                      <TableHead className="text-right">Overdue</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">Month target</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map(x => (
                      <TableRow key={x.id}>
                        <TableCell className="font-medium whitespace-nowrap">{x.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 min-w-[15rem]">
                            {x.signals.length === 0 && <span className="text-muted-foreground">—</span>}
                            {x.signals.map(s => (
                              <Badge key={s.key} variant="outline" className={`font-normal gap-1 ${SIGNAL_STYLE[s.tone]}`}>
                                {s.tone === "warn" ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <CheckCircle2 className="w-3 h-3 shrink-0" />}
                                {s.label}
                              </Badge>
                            ))}
                            </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {x.coachOn ? `${x.replied}/${x.sent}${x.responseRate !== null ? ` · ${x.responseRate}%` : ""}` : <span className="text-muted-foreground">Coach off</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {x.medianReplyMinutes === null ? "—" : formatDuration(x.medianReplyMinutes)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {x.presentDays}{x.lateDays > 0 && <span className="text-muted-foreground"> ({x.lateDays} late)</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{x.leadsTouched}</TableCell>
                        <TableCell className="text-right tabular-nums">{x.stageMoves}</TableCell>
                        <TableCell className="text-right tabular-nums">{x.leadsCreated}</TableCell>
                        <TableCell className="text-right tabular-nums">{x.overdue}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">
                          {!x.presentToday ? (
                            <span className="text-muted-foreground">Not in</span>
                          ) : (
                            <>
                              <div>{x.lastActivityMs ? `Last: ${timeIST(x.lastActivityMs)}` : "No activity yet"}</div>
                              {x.quietMinutes !== null && <div className="text-muted-foreground">Quiet up to {formatDuration(x.quietMinutes)}</div>}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {x.monthTarget ? `${Math.round((x.monthWon / x.monthTarget) * 100)}% · ${inr(x.monthWon)}` : x.monthWon ? inr(x.monthWon) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {sorted.length === 0 && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No sales reps found.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground px-6 pt-3">
                "Replied" = wrote back to a check-in before the next one (or within 3 hours). "Leads touched" counts leads whose latest update
                was by that rep in the period. "Quiet" is the longest stretch today, from clock-in or 11 am, with no stage move, lead update or coach reply;
                it can't see phone calls or showroom time. Updated {timeIST(report.generatedAt)}.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default AdminCoachEfficiency;

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, User, TrendingUp } from "lucide-react";

interface Row {
  month: string;
  user_id: string;
  salesperson_name: string | null;
  profile_picture_url: string | null;
  designation: string | null;
  leads_count: number;
  qualified_leads: number;
  closed_deals: number;
  avg_feedback_score: number | null;
  won_value: number;
  leads_created: number;
  followups_sent: number;
  updates_made: number;
  overdue_count: number;
  reviews_collected: number;
  inventory_actions: number;
  ontime_days: number;
  working_days: number;
  score_sales: number;
  score_closed: number;
  score_reviews: number;
  score_entry: number;
  score_followups: number;
  score_updates: number;
  score_overdue: number;
  score_inventory: number;
  score_attendance: number;
  total_score: number;
  rank_position: number;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthLabel(s: string) {
  return new Date(s).toLocaleString("default", { month: "long", year: "numeric" });
}
const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const SCORE_FIELDS: Array<{ key: keyof Row; label: string; max: number }> = [
  { key: "score_sales", label: "Sales value", max: 25 },
  { key: "score_attendance", label: "On-time attendance", max: 12 },
  { key: "score_closed", label: "Closed deals", max: 10 },
  { key: "score_reviews", label: "Reviews collected", max: 10 },
  { key: "score_followups", label: "Follow-ups", max: 10 },
  { key: "score_overdue", label: "Low overdue", max: 10 },
  { key: "score_entry", label: "Data entry", max: 8 },
  { key: "score_inventory", label: "Inventory", max: 8 },
  { key: "score_updates", label: "Updates", max: 7 },
];

export default function MonthlyLeaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>(monthKey(new Date()));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("monthly_sales_leaderboard" as any)
        .select("*")
        .order("month", { ascending: false })
        .order("rank_position", { ascending: true })
        .limit(500);
      setRows((data as any) || []);
      setLoading(false);
    })();
  }, []);

  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month));
    set.add(monthKey(new Date()));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const monthRows = rows.filter(r => r.month === month).sort((a, b) => a.rank_position - b.rank_position);
  const winner = monthRows[0];

  const topFactors = (r: Row) =>
    [...SCORE_FIELDS]
      .map(f => ({ label: f.label, value: r[f.key] as number, max: f.max }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);

  const rankColor = (r: number) =>
    r === 1 ? "bg-primary/10 border-primary/40"
    : r === 2 ? "bg-secondary"
    : r === 3 ? "bg-accent/30"
    : "";

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <TooltipProvider>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex-1">Monthly Sales Leaderboard</h1>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden border-primary/40 bg-gradient-to-br from-primary/10 via-accent/10 to-background">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-primary font-semibold mb-4">
              <Trophy className="w-5 h-5" />
              Salesperson of {monthLabel(month)}
            </div>
            {winner ? (
              <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
                <Avatar className="w-28 h-28 ring-4 ring-primary/40">
                  <AvatarImage src={winner.profile_picture_url || undefined} />
                  <AvatarFallback><User className="w-12 h-12" /></AvatarFallback>
                </Avatar>
                <div className="flex-1 text-center md:text-left w-full">
                  <h2 className="text-2xl font-bold">{winner.salesperson_name || "Unknown"}</h2>
                  <p className="text-muted-foreground">{winner.designation || "—"}</p>
                  <div className="mt-2 inline-flex items-center gap-2 bg-primary/15 text-primary rounded-full px-3 py-1 text-sm font-semibold">
                    <TrendingUp className="w-4 h-4" /> Score {winner.total_score}/100
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                    <Stat label="Won value" value={fmt(winner.won_value)} />
                    <Stat label="Closed" value={winner.closed_deals} />
                    <Stat label="Reviews" value={winner.reviews_collected} />
                    <Stat label="Follow-ups" value={winner.followups_sent} />
                    <Stat label="New leads" value={winner.leads_created} />
                    <Stat label="Updates" value={winner.updates_made} />
                    <Stat label="Overdue" value={winner.overdue_count} />
                    <Stat
                      label="On-time"
                      value={winner.working_days ? `${Math.round((winner.ontime_days / winner.working_days) * 100)}%` : "—"}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {topFactors(winner).map(f => (
                      <Badge key={f.label} variant="secondary" className="text-xs">
                        {f.label}: {f.value}/{f.max}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">No activity recorded for this month yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Full leaderboard</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Won ₹</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                  <TableHead className="text-right">Reviews</TableHead>
                  <TableHead className="text-right">Follow-ups</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">On-time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthRows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                )}
                {monthRows.map(r => {
                  const attPct = r.working_days ? Math.round((r.ontime_days / r.working_days) * 100) : 0;
                  return (
                    <TableRow key={r.user_id} className={rankColor(r.rank_position)}>
                      <TableCell className="font-semibold">{r.rank_position}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={r.profile_picture_url || undefined} />
                            <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{r.salesperson_name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{r.designation || ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-bold text-primary cursor-help">{r.total_score}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="space-y-1 text-xs">
                              {SCORE_FIELDS.map(f => (
                                <div key={f.key as string} className="flex justify-between gap-4">
                                  <span>{f.label}</span>
                                  <span className="font-mono">{r[f.key] as number}/{f.max}</span>
                                </div>
                              ))}
                              <div className="flex justify-between gap-4 border-t pt-1 font-semibold">
                                <span>Total</span><span className="font-mono">{r.total_score}/100</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(r.won_value)}</TableCell>
                      <TableCell className="text-right">{r.closed_deals}</TableCell>
                      <TableCell className="text-right">{r.reviews_collected}</TableCell>
                      <TableCell className="text-right">{r.followups_sent}</TableCell>
                      <TableCell className="text-right">
                        {r.overdue_count > 0
                          ? <Badge variant="destructive" className="text-[10px]">{r.overdue_count}</Badge>
                          : r.overdue_count}
                      </TableCell>
                      <TableCell className="text-right">{r.working_days ? `${attPct}%` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

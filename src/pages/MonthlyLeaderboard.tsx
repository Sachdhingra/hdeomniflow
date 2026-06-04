import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trophy, User, Star } from "lucide-react";

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
  rank_position: number;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthLabel(s: string) {
  return new Date(s).toLocaleString("default", { month: "long", year: "numeric" });
}

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

  const rankColor = (r: number) =>
    r === 1 ? "bg-primary/10 border-primary/40"
    : r === 2 ? "bg-secondary"
    : r === 3 ? "bg-accent/30"
    : "";

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
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
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-2xl font-bold">{winner.salesperson_name || "Unknown"}</h2>
                <p className="text-muted-foreground">{winner.designation || "—"}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                  <Stat label="Leads" value={winner.leads_count} />
                  <Stat label="Qualified" value={winner.qualified_leads} />
                  <Stat label="Closed" value={winner.closed_deals} />
                  <Stat label="Avg rating" value={winner.avg_feedback_score ? `${winner.avg_feedback_score}★` : "—"} />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No leads recorded for this month yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Full leaderboard</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Qualified</TableHead>
                <TableHead className="text-right">Closed</TableHead>
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthRows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>
              )}
              {monthRows.map(r => (
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
                  <TableCell className="text-right">{r.leads_count}</TableCell>
                  <TableCell className="text-right">{r.qualified_leads}</TableCell>
                  <TableCell className="text-right">{r.closed_deals}</TableCell>
                  <TableCell className="text-right">
                    {r.avg_feedback_score ? <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" />{r.avg_feedback_score}</span> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
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

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Loader2, RefreshCw, Star, AlertTriangle, TrendingUp, TrendingDown, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  Select as MonthSelect,
  SelectContent as MonthSelectContent,
  SelectItem as MonthSelectItem,
  SelectTrigger as MonthSelectTrigger,
  SelectValue as MonthSelectValue,
} from "@/components/ui/select";

interface Feedback {
  id: string;
  customer_name: string;
  customer_phone: string;
  comments: string | null;
  overall_rating: number;
  staff_rating: number;
  needs_attention: boolean;
  lead_created: boolean;
  lead_id: string | null;
  salesperson_name: string | null;
  created_at: string;
}

const EMOJI = ["😢", "😕", "😐", "😊", "🤩"];

const ratingColor = (r: number) =>
  r >= 4 ? "text-green-600" : r === 3 ? "text-yellow-600" : "text-red-600";

const FeedbackAnalyticsDashboard = () => {
  const [items, setItems] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const load = async () => {
    const { data, error } = await supabase
      .from("customer_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && data) setItems(data as Feedback[]);
    setLoading(false);
    setLastUpdated(new Date());
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this feedback entry permanently?")) return;
    const { error } = await supabase.from("customer_feedback").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Feedback deleted");
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      const d = new Date(i.created_at);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    });
    const cur = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    set.add(cur);
    return Array.from(set).sort().reverse();
  }, [items]);

  const monthItems = useMemo(() => {
    const [y, m] = monthFilter.split("-").map(Number);
    return items.filter((i) => {
      const d = new Date(i.created_at);
      return d.getFullYear() === y && d.getMonth() + 1 === m;
    });
  }, [items, monthFilter]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = monthItems;
    const total = thisMonth.length;
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const avgOverall = avg(thisMonth.map((i) => i.overall_rating));
    const avgStaff = avg(thisMonth.map((i) => i.staff_rating));
    const positive = thisMonth.filter((i) => i.overall_rating >= 4).length;
    const positivePct = total ? Math.round((positive / total) * 100) : 0;

    const dist = [5, 4, 3, 2, 1].map((star) => ({
      name: `${star}★`,
      count: thisMonth.filter((i) => i.overall_rating === star).length,
    }));

    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    const lastWeek = items.filter(
      (i) => new Date(i.created_at) >= weekAgo
    );
    const prevWeek = items.filter(
      (i) => new Date(i.created_at) >= twoWeeksAgo && new Date(i.created_at) < weekAgo
    );
    const trend = avg(lastWeek.map((i) => i.overall_rating)) - avg(prevWeek.map((i) => i.overall_rating));
    const attention = thisMonth.filter((i) => i.needs_attention).length;

    return { total, avgOverall, avgStaff, positive, positivePct, dist, trend, attention };
  }, [items, monthItems]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Customer Feedback</h1>
          <p className="text-sm text-muted-foreground">Kiosk feedback analytics &amp; insights</p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelect value={monthFilter} onValueChange={setMonthFilter}>
            <MonthSelectTrigger className="w-[180px]">
              <MonthSelectValue placeholder="Select month" />
            </MonthSelectTrigger>
            <MonthSelectContent>
              {availableMonths.map((m) => {
                const [y, mo] = m.split("-").map(Number);
                const label = new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
                return <MonthSelectItem key={m} value={m}>{label}</MonthSelectItem>;
              })}
            </MonthSelectContent>
          </MonthSelect>
          <button
            onClick={load}
            className="text-sm flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Last updated {lastUpdated.toLocaleTimeString()}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">This month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total feedback</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Avg overall</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${ratingColor(Math.round(stats.avgOverall))}`}>
              {stats.avgOverall.toFixed(1)}/5
            </div>
            <div className="flex gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= Math.round(stats.avgOverall) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Avg staff</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${ratingColor(Math.round(stats.avgStaff))}`}>
              {stats.avgStaff.toFixed(1)}/5
            </div>
            <p className="text-xs text-muted-foreground">Experience quality</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Positive</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.positivePct}%</div>
            <p className="text-xs text-muted-foreground">{stats.positive} of 4 &amp; 5 stars</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Rating distribution (this month)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.dist}>
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {stats.dist.map((_, i) => (
                    <Bar key={i} dataKey="count" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              {stats.trend >= 0 ? (
                <TrendingUp className="w-5 h-5 text-green-600" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-600" />
              )}
              <span>
                Avg rating trending <strong>{stats.trend >= 0 ? "up" : "down"}</strong> this week
                ({stats.trend >= 0 ? "+" : ""}{stats.trend.toFixed(2)})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span>
                <strong>{stats.attention}</strong> review{stats.attention === 1 ? "" : "s"} need attention (1–2 stars)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Salesperson</TableHead>
                  <TableHead>Overall</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Comments</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthItems.slice(0, 50).map((f) => (
                  <TableRow
                    key={f.id}
                    className={
                      f.overall_rating >= 4
                        ? "bg-green-50/50"
                        : f.overall_rating === 3
                        ? "bg-yellow-50/50"
                        : "bg-red-50/50"
                    }
                  >
                    <TableCell className="font-medium">{f.customer_name}</TableCell>
                    <TableCell>{f.customer_phone}</TableCell>
                    <TableCell className="text-sm">{f.salesperson_name || "—"}</TableCell>
                    <TableCell>
                      <span className="text-xl mr-1">{EMOJI[f.overall_rating - 1]}</span>
                      {f.overall_rating}
                    </TableCell>
                    <TableCell>
                      <span className="text-xl mr-1">{EMOJI[f.staff_rating - 1]}</span>
                      {f.staff_rating}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {f.comments || "—"}
                    </TableCell>
                    <TableCell>
                      {f.lead_id ? (
                        <Link to="/leads/board" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                          {f.lead_created ? <Badge variant="secondary">✅ New</Badge> : <Badge variant="outline">Updated</Badge>}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(f.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(f.id)} aria-label="Delete">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No feedback yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default FeedbackAnalyticsDashboard;

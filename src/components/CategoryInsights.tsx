import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LEAD_CATEGORIES } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, TrendingDown, Minus, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface RawLead {
  category: string;
  status: string;
  value_in_rupees: number | null;
  created_at: string;
}

interface MonthCell {
  count: number;
  won: number;
  lost: number;
  value: number;
}

interface CategoryRow {
  value: string;
  label: string;
  months: Record<string, MonthCell>;
  total: number;
  wonTotal: number;
  lostTotal: number;
  totalValue: number;
  trend: "up" | "down" | "flat";
  trendPct: number;
  attention: string[];
}

const N = 6;

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16",
];

function buildMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function toMonthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

const CategoryInsights = () => {
  const monthKeys = useMemo(() => buildMonthKeys(N), []);
  const [raw, setRaw] = useState<RawLead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date();
    since.setMonth(since.getMonth() - N);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("leads")
      .select("category, status, value_in_rupees, created_at")
      .gte("created_at", since.toISOString())
      .is("deleted_at", null);

    if (!error) setRaw((data || []) as unknown as RawLead[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo((): CategoryRow[] => {
    return LEAD_CATEGORIES.map(cat => {
      const catLeads = raw.filter(l => l.category === cat.value);

      const months: Record<string, MonthCell> = Object.fromEntries(
        monthKeys.map(k => [k, { count: 0, won: 0, lost: 0, value: 0 }])
      );

      for (const l of catLeads) {
        const mk = toMonthKey(l.created_at);
        if (months[mk]) {
          months[mk].count++;
          if (l.status === "won" || l.status === "converted") months[mk].won++;
          if (l.status === "lost") months[mk].lost++;
          months[mk].value += Number(l.value_in_rupees ?? 0);
        }
      }

      const total = catLeads.length;
      const wonTotal = catLeads.filter(l => l.status === "won" || l.status === "converted").length;
      const lostTotal = catLeads.filter(l => l.status === "lost").length;
      const totalValue = catLeads.reduce((s, l) => s + Number(l.value_in_rupees ?? 0), 0);

      const currMk = monthKeys.at(-1)!;
      const prevMk = monthKeys.at(-2)!;
      const curr = months[currMk].count;
      const prev = months[prevMk].count;
      let trend: "up" | "down" | "flat" = "flat";
      let trendPct = 0;
      if (prev > 0) {
        trendPct = Math.round(((curr - prev) / prev) * 100);
        trend = curr > prev ? "up" : curr < prev ? "down" : "flat";
      } else if (curr > 0) {
        trend = "up"; trendPct = 100;
      }

      const attention: string[] = [];
      if (curr === 0 && total > 0) attention.push("No leads this month");
      const last3 = monthKeys.slice(-3).map(k => months[k].count);
      if (last3[0] > 0 && last3[2] < last3[1] && last3[1] <= last3[0]) {
        attention.push("Declining 3 months");
      }
      if (total >= 5 && wonTotal / total < 0.15) {
        attention.push(`Low win rate (${Math.round((wonTotal / total) * 100)}%)`);
      }
      if (total >= 5 && lostTotal / total > 0.4) {
        attention.push(`High loss rate (${Math.round((lostTotal / total) * 100)}%)`);
      }

      return {
        value: cat.value, label: cat.label, months,
        total, wonTotal, lostTotal, totalValue,
        trend, trendPct, attention,
      };
    });
  }, [raw, monthKeys]);

  const attentionRows = useMemo(() => rows.filter(r => r.attention.length > 0), [rows]);

  const top5 = useMemo(
    () => [...rows].sort((a, b) => b.total - a.total).slice(0, 5),
    [rows]
  );

  const chartData = useMemo(
    () => monthKeys.map(mk => ({
      month: shortMonth(mk),
      ...Object.fromEntries(top5.map(r => [r.label, r.months[mk].count])),
    })),
    [monthKeys, top5]
  );

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Category Insights — Last 6 Months
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-7 w-7 p-0">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Needs Attention */}
        {attentionRows.length > 0 && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Needs Attention
            </p>
            <div className="flex flex-wrap gap-2">
              {attentionRows.map(r => (
                <div
                  key={r.value}
                  className="text-xs bg-white dark:bg-muted rounded-md px-2.5 py-1.5 border border-amber-200 dark:border-amber-700/50"
                >
                  <span className="font-semibold">{r.label}</span>
                  {r.attention.map(a => (
                    <span key={a} className="block text-amber-600 dark:text-amber-400 text-[10px]">{a}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trend chart — top 5 by volume */}
        {loading ? (
          <div className="flex items-center justify-center h-[190px]">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              Monthly Lead Volume — Top 5 Categories
            </p>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                {top5.map((r, i) => (
                  <Line
                    key={r.value}
                    type="monotone"
                    dataKey={r.label}
                    stroke={COLORS[i]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Month-wise breakdown table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 pr-4 font-medium w-28">Category</th>
                {monthKeys.map((mk, i) => (
                  <th
                    key={mk}
                    className={`text-center py-2 px-2 font-medium min-w-[40px] ${i === N - 1 ? "text-foreground" : ""}`}
                  >
                    {shortMonth(mk)}
                  </th>
                ))}
                <th className="text-center py-2 px-2 font-medium">Trend</th>
                <th className="text-center py-2 px-2 font-medium">6m</th>
                <th className="text-center py-2 px-2 font-medium">Win%</th>
                <th className="text-right py-2 pl-3 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const winRate = r.total > 0 ? Math.round((r.wonTotal / r.total) * 100) : 0;
                const winCls =
                  winRate >= 30 ? "text-success font-medium"
                  : winRate >= 15 ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground";
                return (
                  <tr key={r.value} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2 pr-4 font-medium">{r.label}</td>
                    {monthKeys.map((mk, i) => {
                      const cell = r.months[mk];
                      const prevCell = i > 0 ? r.months[monthKeys[i - 1]] : null;
                      const up = prevCell && cell.count > prevCell.count;
                      const dn = prevCell && cell.count < prevCell.count && cell.count > 0;
                      return (
                        <td
                          key={mk}
                          title={
                            cell.count > 0
                              ? `Won: ${cell.won} | Lost: ${cell.lost} | ₹${(cell.value / 1000).toFixed(1)}K`
                              : undefined
                          }
                          className={[
                            "text-center py-2 px-2 tabular-nums cursor-default",
                            i === N - 1 ? "font-bold" : "",
                            cell.count === 0 ? "text-muted-foreground/35" : up ? "text-success" : dn ? "text-destructive/80" : "",
                          ].join(" ")}
                        >
                          {cell.count || "—"}
                        </td>
                      );
                    })}
                    {/* Trend */}
                    <td className="text-center py-2 px-2 whitespace-nowrap">
                      {r.trend === "up" ? (
                        <span className="inline-flex items-center gap-0.5 text-success font-medium">
                          <TrendingUp className="w-3 h-3" />
                          {r.trendPct > 0 ? `+${r.trendPct}%` : "new"}
                        </span>
                      ) : r.trend === "down" ? (
                        <span className="inline-flex items-center gap-0.5 text-destructive font-medium">
                          <TrendingDown className="w-3 h-3" />
                          {r.trendPct}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          <Minus className="w-3 h-3 inline" />
                        </span>
                      )}
                    </td>
                    <td className="text-center py-2 px-2 font-semibold tabular-nums">
                      {r.total || "—"}
                    </td>
                    <td className={`text-center py-2 px-2 tabular-nums ${winCls}`}>
                      {r.total > 0 ? `${winRate}%` : "—"}
                    </td>
                    <td className="text-right py-2 pl-3 tabular-nums text-muted-foreground">
                      {r.totalValue > 0 ? `₹${(r.totalValue / 1000).toFixed(0)}K` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Hover any month cell to see Won / Lost / ₹ Value breakdown.
          Green = higher than prev month · Red = lower · Bold = current month.
          Trend compares current month vs previous month.
        </p>
      </CardContent>
    </Card>
  );
};

export default CategoryInsights;

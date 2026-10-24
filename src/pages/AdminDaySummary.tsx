import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import DaySummaryReport from "@/components/admin/DaySummaryReport";
import { toast } from "@/lib/toast";
import { istDateString } from "@/lib/coachEfficiency";
import type { DayReport } from "../../supabase/functions/_shared/day-summary";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Row {
  id: string;
  summary_date: string;
  generated_at: string;
  report: DayReport;
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

const AdminDaySummary = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await db
      .from("admin_daily_summaries")
      .select("id,summary_date,generated_at,report")
      .order("summary_date", { ascending: false })
      .limit(30);
    const list = (data ?? []) as Row[];
    setRows(list);
    setSelected(prev => prev ?? list[0]?.summary_date ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; message?: string; date?: string }>(
        "daily-admin-summary",
        { body: { force: true, notify: false } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.message ?? data.error);
      await load();
      if (data?.date) setSelected(data.date);
      toast.success("Summary updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the summary");
    } finally {
      setGenerating(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">Day Summary unavailable</h1>
        <p className="text-muted-foreground">This page is for admins only.</p>
      </div>
    );
  }

  const current = rows.find(r => r.summary_date === selected) ?? null;
  const today = istDateString(new Date());
  const hasToday = rows.some(r => r.summary_date === today);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[14rem]">
          <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Day Summary</h1>
            <p className="text-xs text-muted-foreground">Built every evening at 8:05 pm. Open any earlier day below.</p>
          </div>
        </div>
        <Button variant="outline" onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {hasToday ? "Refresh today" : "Build today's now"}
        </Button>
      </div>

      {loading && <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-muted-foreground" />}

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No summaries yet. The first one is built at 8:05 pm — or tap “Build today's now”.
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="grid md:grid-cols-[11rem_1fr] gap-4 items-start">
          <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1">
            {rows.map(r => (
              <Button
                key={r.id}
                size="sm"
                variant={r.summary_date === selected ? "default" : "outline"}
                className="justify-start whitespace-nowrap"
                onClick={() => setSelected(r.summary_date)}
              >
                {shortDate(r.summary_date)}
              </Button>
            ))}
          </div>
          <Card>
            <CardContent className="p-5">{current && <DaySummaryReport report={current.report} />}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminDaySummary;

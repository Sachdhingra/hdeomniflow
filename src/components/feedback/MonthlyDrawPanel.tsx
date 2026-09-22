import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Gift, Loader2, RefreshCw, Send, Trophy } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  DEFAULT_MIN_DRAW_ENTRIES,
  currentDrawMonth,
  drawEligibility,
  monthLabel,
  previousDrawMonth,
} from "@/lib/monthlyDraw";

interface DrawRow {
  id: string;
  draw_month: string;
  status: string;
  total_entries: number;
  min_entries_required: number;
  winner_name: string | null;
  winner_phone: string | null;
  prize: string | null;
  drawn_at: string | null;
  winner_notified_at: string | null;
  notes: string | null;
}

interface EntryCount {
  draw_month: string;
  entries: number;
}

/**
 * Monthly lucky draw for customers who left a Google review.
 * One winner per month, drawn in the first week of the following month by the
 * `monthly-review-draw` cron — but only once the month has cleared the entry
 * threshold. This panel shows where each month stands and lets an admin run
 * the draw by hand.
 */
const MonthlyDrawPanel = () => {
  const [draws, setDraws] = useState<DrawRow[]>([]);
  const [counts, setCounts] = useState<EntryCount[]>([]);
  const [minEntries, setMinEntries] = useState(DEFAULT_MIN_DRAW_ENTRIES);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [drawRes, countRes, settingRes] = await Promise.all([
      (supabase as any)
        .from("monthly_draws")
        .select("*")
        .order("draw_month", { ascending: false })
        .limit(24),
      (supabase as any).rpc("fn_monthly_draw_entry_counts"),
      supabase.from("app_settings").select("key,value").eq("key", "monthly_draw_min_entries"),
    ]);

    if (drawRes.data) setDraws(drawRes.data as DrawRow[]);
    if (countRes.data) {
      setCounts(
        (countRes.data as any[]).map((r) => ({
          draw_month: r.draw_month,
          entries: Number(r.entries) || 0,
        })),
      );
    }
    const raw = settingRes.data?.[0]?.value;
    const parsed = parseInt(raw ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) setMinEntries(parsed);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entriesFor = useCallback(
    (month: string) => counts.find((c) => c.draw_month === month)?.entries ?? 0,
    [counts],
  );

  const thisMonth = currentDrawMonth();
  const lastMonth = previousDrawMonth();
  const thisMonthStatus = useMemo(
    () => drawEligibility(entriesFor(thisMonth), minEntries),
    [entriesFor, thisMonth, minEntries],
  );
  const lastMonthDraw = draws.find((d) => d.draw_month === lastMonth);
  const lastMonthEntries = lastMonthDraw?.total_entries ?? entriesFor(lastMonth);
  const lastMonthStatus = drawEligibility(lastMonthEntries, minEntries);

  const runDraw = async (month: string, force: boolean) => {
    if (force && !confirm(`Run the ${monthLabel(month)} draw with fewer than ${minEntries} entries?`)) {
      return;
    }
    setRunning(true);
    const { data, error } = await (supabase as any).rpc("fn_run_monthly_draw", {
      p_month: month,
      p_force: force,
    });
    setRunning(false);
    if (error) return toast.error(error.message);

    const result = data as any;
    if (result?.ran) {
      toast.success(`Winner: ${result.winner_name} (${result.winner_phone}) — WhatsApp on its way`);
    } else if (result?.reason === "already_drawn") {
      toast.info(`${monthLabel(month)} was already drawn — winner ${result.winner_name}`);
    } else if (result?.reason === "insufficient_entries") {
      toast.info(`Only ${result.entries} of ${result.min_entries} entries — no draw yet`);
    } else if (result?.reason === "draw_disabled") {
      toast.info("The monthly draw is switched off in settings");
    } else {
      toast.info("No entries to draw from yet");
    }
    load();
  };

  const resend = async (drawId: string) => {
    setResending(drawId);
    const { error } = await (supabase as any).rpc("fn_resend_draw_winner_message", {
      p_draw_id: drawId,
    });
    setResending(null);
    if (error) return toast.error(error.message);
    toast.success("Winner message queued");
    load();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Gift className="w-4 h-4" /> {monthLabel(thisMonth)} entries
          </CardTitle>
          <button onClick={load} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className="w-4 h-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-3xl font-bold">
            {entriesFor(thisMonth)}
            <span className="text-base font-normal text-muted-foreground"> / {minEntries}</span>
          </div>
          <Progress value={thisMonthStatus.progressPct} />
          <p className="text-xs text-muted-foreground">
            {thisMonthStatus.eligible
              ? "Threshold cleared — this month will be drawn in the first week of next month."
              : `${thisMonthStatus.remaining} more Google review${
                  thisMonthStatus.remaining === 1 ? "" : "s"
                } needed before this month can be drawn.`}
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4" /> {monthLabel(lastMonth)} draw
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lastMonthDraw?.status === "completed" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-bold">{lastMonthDraw.winner_name}</span>
                <Badge variant="secondary">{lastMonthDraw.winner_phone}</Badge>
                <Badge variant={lastMonthDraw.winner_notified_at ? "default" : "outline"}>
                  {lastMonthDraw.winner_notified_at ? "WhatsApp sent" : "Not notified yet"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Drawn {lastMonthDraw.drawn_at ? new Date(lastMonthDraw.drawn_at).toLocaleString() : "—"}{" "}
                from {lastMonthDraw.total_entries} entries
                {lastMonthDraw.prize ? ` · Prize: ${lastMonthDraw.prize}` : ""}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => resend(lastMonthDraw.id)}
                disabled={resending === lastMonthDraw.id}
              >
                {resending === lastMonthDraw.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Resend winner message
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                {lastMonthEntries} entr{lastMonthEntries === 1 ? "y" : "ies"} — {""}
                {lastMonthStatus.eligible
                  ? "ready to draw."
                  : `${lastMonthStatus.remaining} short of the ${minEntries}-entry minimum, so no draw runs for this month.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => runDraw(lastMonth, false)}
                  disabled={running || !lastMonthStatus.eligible}
                >
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
                  Run draw now
                </Button>
                {!lastMonthStatus.eligible && lastMonthEntries > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runDraw(lastMonth, true)}
                    disabled={running}
                  >
                    Draw anyway
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Past winners</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Prize</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draws.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{monthLabel(d.draw_month)}</TableCell>
                    <TableCell>
                      {d.total_entries} / {d.min_entries_required}
                    </TableCell>
                    <TableCell>{d.winner_name ?? "—"}</TableCell>
                    <TableCell>{d.winner_phone ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.prize ?? "—"}</TableCell>
                    <TableCell>
                      {d.status === "completed" ? (
                        <Badge variant={d.winner_notified_at ? "default" : "outline"}>
                          {d.winner_notified_at ? "Winner notified" : "Winner picked"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Waiting for entries</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.status === "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resend(d.id)}
                          disabled={resending === d.id}
                        >
                          {resending === d.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {draws.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No draw has run yet.
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

export default MonthlyDrawPanel;

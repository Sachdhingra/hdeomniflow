import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DaySummaryReport from "@/components/admin/DaySummaryReport";
import type { DayReport } from "../../../supabase/functions/_shared/day-summary";

// A summary older than this is stale news — don't pop it up when an admin
// comes back after a few days away (it is still on the Day Summary page).
const FRESH_MS = 36 * 60 * 60 * 1000;

interface SummaryRow {
  id: string;
  summary_date: string;
  generated_at: string;
  report: DayReport;
}

// The new tables are not in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// Admin only: the 8:05 pm day summary appears as a pop-up the moment it is ready
// (realtime), or the next time an admin opens the app if they missed it.
const AdminDaySummaryPopup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [row, setRow] = useState<SummaryRow | null>(null);
  const [open, setOpen] = useState(false);
  const shownRef = useRef<Set<string>>(new Set());

  const check = useCallback(async () => {
    if (!user) return;
    const { data: latest } = await db
      .from("admin_daily_summaries")
      .select("id,summary_date,generated_at,report")
      .order("summary_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || shownRef.current.has(latest.id)) return;
    if (Date.now() - new Date(latest.generated_at).getTime() > FRESH_MS) return;
    const { data: seen } = await db
      .from("admin_summary_views")
      .select("summary_id")
      .eq("summary_id", latest.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (seen) return;
    shownRef.current.add(latest.id);
    setRow(latest as SummaryRow);
    setOpen(true);
  }, [user]);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`admin-day-summary-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_daily_summaries" }, () => check())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, check]);

  const markSeen = async () => {
    setOpen(false);
    if (!row || !user) return;
    // Ignore a repeat (primary key) — seen is seen.
    await db.from("admin_summary_views").upsert({ summary_id: row.id, user_id: user.id }, { onConflict: "summary_id,user_id", ignoreDuplicates: true });
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={o => !o && setOpen(false) /* closing without "Got it" = remind me later */}>
      <DialogContent className="max-w-2xl max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" /> Today's summary
          </DialogTitle>
          <DialogDescription>Who needs a closer look, what was done, and tomorrow's plan.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-6 pb-4">
          <DaySummaryReport report={row.report} />
        </div>
        <DialogFooter className="gap-2 border-t px-6 py-3 sm:gap-2">
          <Button
            variant="outline"
            className="hidden sm:inline-flex"
            onClick={() => {
              setOpen(false);
              navigate("/admin/coach-efficiency");
            }}
          >
            Coach efficiency
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Remind me later
          </Button>
          <Button autoFocus onClick={markSeen}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminDaySummaryPopup;

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Clock, LogIn, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AttendanceRow {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  status: string;
  minutes_late: number;
  working_hours: number | null;
}

const istToday = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
};

const AttendanceClockButton = () => {
  const { user } = useAuth();
  const [row, setRow] = useState<AttendanceRow | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchToday = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("attendance").select("*")
      .eq("user_id", user.id).eq("date", istToday()).maybeSingle();
    setRow(data as AttendanceRow | null);
  }, [user]);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  const clock = async (action: "in" | "out") => {
    setLoading(true);
    const getPos = () => new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(p => resolve(p), () => resolve(null), { timeout: 4000 });
    });
    const pos = await getPos();
    const { data, error } = await (supabase as any).rpc("attendance_clock", {
      p_action: action,
      p_lat: pos?.coords.latitude ?? null,
      p_lng: pos?.coords.longitude ?? null,
    });
    if (error) {
      toast.error(error.message || "Failed");
    } else {
      setRow(data as AttendanceRow);
      toast.success(action === "in" ? "Clocked in" : "Clocked out");
    }
    setLoading(false);
  };

  if (!user) return null;

  // Already clocked out
  if (row?.clock_out) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted text-muted-foreground">
        <Clock className="w-3.5 h-3.5" />
        Worked {row.working_hours ?? 0}h today
      </div>
    );
  }

  // Clocked in, not out
  if (row?.clock_in) {
    return (
      <Button size="sm" variant="outline" onClick={() => clock("out")} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">Clock Out</span>
        {row.status === "late" && (
          <span className="text-[10px] text-destructive font-semibold ml-1">+{row.minutes_late}m late</span>
        )}
      </Button>
    );
  }

  // Not clocked in
  return (
    <Button size="sm" onClick={() => clock("in")} disabled={loading} className="gap-1.5 gradient-primary">
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">Clock In</span>
    </Button>
  );
};

export default AttendanceClockButton;

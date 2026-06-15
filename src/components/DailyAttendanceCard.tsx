import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface Row {
  user_id: string;
  name: string;
  role: string;
  status: string;
  clock_in: string | null;
  minutes_late: number;
}

const DailyAttendanceCard = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("attendance_today_summary");
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  const onTime = rows.filter(r => r.status === "on_time").length;
  const late = rows.filter(r => r.status === "late").length;
  const absent = rows.filter(r => r.status === "absent").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="w-4 h-4" /> Today's Attendance
        </CardTitle>
        <Link to="/attendance" className="text-xs text-primary hover:underline">View report →</Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded border bg-success/10 p-2 text-center">
                <CheckCircle className="w-4 h-4 text-success mx-auto mb-1" />
                <div className="text-lg font-bold text-success">{onTime}</div>
                <div className="text-[10px] text-muted-foreground">On time</div>
              </div>
              <div className="rounded border bg-destructive/10 p-2 text-center">
                <AlertTriangle className="w-4 h-4 text-destructive mx-auto mb-1" />
                <div className="text-lg font-bold text-destructive">{late}</div>
                <div className="text-[10px] text-muted-foreground">Late</div>
              </div>
              <div className="rounded border bg-muted p-2 text-center">
                <XCircle className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                <div className="text-lg font-bold">{absent}</div>
                <div className="text-[10px] text-muted-foreground">Absent</div>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {rows.map(r => (
                <div key={r.user_id} className="flex items-center justify-between text-xs py-1 border-b last:border-b-0">
                  <span className="truncate">{r.name} <span className="text-muted-foreground">· {r.role}</span></span>
                  {r.status === "on_time" && <Badge className="bg-success text-success-foreground text-[10px]">On time</Badge>}
                  {r.status === "late" && <Badge variant="destructive" className="text-[10px]">Late +{r.minutes_late}m</Badge>}
                  {r.status === "absent" && <Badge variant="secondary" className="text-[10px]">Absent</Badge>}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyAttendanceCard;

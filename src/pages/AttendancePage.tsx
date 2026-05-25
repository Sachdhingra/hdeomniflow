import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface Row {
  user_id: string;
  name: string;
  email: string;
  role: string;
  date: string;
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  minutes_late: number;
  working_hours: number | null;
}

const currentMonth = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

interface SummaryRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  days_present: number;
  days_on_time: number;
  days_late: number;
  days_absent: number;
  working_days: number;
}

const AttendancePage = () => {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const isPriv = user?.role === "admin" || user?.role === "accounts";

  const load = async (m: string) => {
    setLoading(true);
    const [{ data, error }, sumRes] = await Promise.all([
      (supabase as any).rpc("attendance_monthly_report", { p_month: m }),
      (supabase as any).rpc("attendance_monthly_user_summary", { p_month: m, p_user_id: null }),
    ]);
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setSummary((sumRes.data as SummaryRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(month); }, [month]);

  const stats = useMemo(() => {
    const total = rows.length;
    const onTime = rows.filter(r => r.status === "on_time").length;
    const late = rows.filter(r => r.status === "late").length;
    const punctual = total ? Math.round((onTime / total) * 100) : 0;
    const totalHours = rows.reduce((s, r) => s + Number(r.working_hours || 0), 0);
    return { total, onTime, late, punctual, totalHours };
  }, [rows]);

  const exportCsv = () => {
    const header = ["Date", "Name", "Role", "Status", "Clock In", "Clock Out", "Minutes Late", "Working Hours"];
    const csvRows = rows.map(r => [
      r.date, r.name, r.role, r.status, fmtTime(r.clock_in), fmtTime(r.clock_out),
      r.minutes_late, r.working_hours ?? "",
    ]);
    const csv = [header, ...csvRows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `attendance-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Attendance Report — ${month}`, 14, 14);
    doc.setFontSize(9);
    doc.text(
      `Records: ${stats.total}  |  On time: ${stats.onTime}  |  Late: ${stats.late}  |  Punctuality: ${stats.punctual}%  |  Total hours: ${stats.totalHours.toFixed(1)}`,
      14, 21,
    );
    autoTable(doc, {
      startY: 26,
      head: [["Date", "Name", "Role", "Status", "Clock In", "Clock Out", "Late (m)", "Hours"]],
      body: rows.map(r => [
        r.date, r.name, r.role, r.status, fmtTime(r.clock_in), fmtTime(r.clock_out),
        r.minutes_late, r.working_hours ?? "—",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    doc.save(`attendance-${month}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Work hours 11:00 AM – 8:00 PM IST. Clock-in after 11:10 AM is marked late.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">
            Monthly Report {isPriv ? "(All Employees)" : "(My Attendance)"}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
            <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button size="sm" onClick={exportPdf} className="gap-1.5 gradient-primary">
              <FileText className="w-4 h-4" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            <Stat label="Records" value={stats.total} />
            <Stat label="On time" value={stats.onTime} tone="success" />
            <Stat label="Late" value={stats.late} tone="destructive" />
            <Stat label="Punctuality" value={`${stats.punctual}%`} />
            <Stat label="Total hours" value={stats.totalHours.toFixed(1)} />
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No attendance records for this month</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {isPriv && <TableHead>Name</TableHead>}
                    {isPriv && <TableHead>Role</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.user_id}-${r.date}-${i}`}>
                      <TableCell className="text-xs">{r.date}</TableCell>
                      {isPriv && <TableCell className="text-xs font-medium">{r.name}</TableCell>}
                      {isPriv && <TableCell className="text-xs text-muted-foreground">{r.role}</TableCell>}
                      <TableCell>
                        {r.status === "on_time" && <Badge className="bg-success text-success-foreground text-[10px]">On time</Badge>}
                        {r.status === "late" && <Badge variant="destructive" className="text-[10px]">Late +{r.minutes_late}m</Badge>}
                        {r.status === "absent" && <Badge variant="secondary" className="text-[10px]">Absent</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{fmtTime(r.clock_in)}</TableCell>
                      <TableCell className="text-xs">{fmtTime(r.clock_out)}</TableCell>
                      <TableCell className="text-xs">{r.working_hours ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Monthly Summary {isPriv ? "(Per Employee)" : ""}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Working days exclude Sundays. Auto clock-out runs daily at 8:05 PM IST.
          </p>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground text-sm">No summary available</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isPriv && <TableHead>Employee</TableHead>}
                    <TableHead className="text-center">Present</TableHead>
                    <TableHead className="text-center">On Time</TableHead>
                    <TableHead className="text-center">Late</TableHead>
                    <TableHead className="text-center">Absent</TableHead>
                    <TableHead className="text-center">Working Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.user_id}>
                      {isPriv && (
                        <TableCell className="text-xs font-medium">
                          {s.name}
                          <div className="text-[10px] text-muted-foreground">{s.role}</div>
                        </TableCell>
                      )}
                      <TableCell className="text-center text-xs font-semibold">{s.days_present}</TableCell>
                      <TableCell className="text-center text-xs text-success">{s.days_on_time}</TableCell>
                      <TableCell className="text-center text-xs text-destructive">{s.days_late}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">{s.days_absent}</TableCell>
                      <TableCell className="text-center text-xs">{s.working_days}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: any; tone?: "success" | "destructive" }) => (
  <div className={`rounded border p-2 text-center ${tone === "success" ? "bg-success/10" : tone === "destructive" ? "bg-destructive/10" : "bg-muted/40"}`}>
    <div className={`text-lg font-bold ${tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : ""}`}>{value}</div>
    <div className="text-[10px] text-muted-foreground">{label}</div>
  </div>
);

export default AttendancePage;

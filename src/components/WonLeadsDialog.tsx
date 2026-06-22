import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface WonLead {
  id: string;
  customer_name: string;
  customer_phone: string;
  category: string;
  value_in_rupees: number;
  assigned_to: string | null;
  created_by: string | null;
  stage_changed_at: string | null;
  updated_at: string;
  created_at: string;
  notes: string | null;
  delivery_date: string | null;
  next_follow_up_date: string | null;
}

type Preset = "today" | "week" | "month" | "fy" | "all" | "custom";

const todayISO = () => new Date().toISOString().split("T")[0];
const daysAgo = (d: number) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.toISOString().split("T")[0];
};
const monthStartISO = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split("T")[0];
};
const fyStartISO = () => {
  const n = new Date();
  const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
  return `${y}-04-01`;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const WonLeadsDialog = ({ open, onOpenChange }: Props) => {
  const { allProfiles } = useAuth();
  const [preset, setPreset] = useState<Preset>("month");
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<WonLead[]>([]);

  const nameOf = (id: string | null) =>
    id ? allProfiles.find(p => p.id === id)?.name || "—" : "—";

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const t = todayISO();
    if (p === "today") { setFromDate(t); setToDate(t); }
    else if (p === "week") { setFromDate(daysAgo(6)); setToDate(t); }
    else if (p === "month") { setFromDate(monthStartISO()); setToDate(t); }
    else if (p === "fy") { setFromDate(fyStartISO()); setToDate(t); }
    else if (p === "all") { setFromDate(""); setToDate(""); }
  };

  const fetchWon = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("leads")
        .select("id, customer_name, customer_phone, category, value_in_rupees, assigned_to, created_by, stage_changed_at, updated_at, created_at, notes, delivery_date, next_follow_up_date")
        .eq("status", "won")
        .is("deleted_at", null)
        .order("stage_changed_at", { ascending: false, nullsFirst: false })
        .limit(5000);
      const { data, error } = await q;
      if (error) throw error;
      let list = (data ?? []) as WonLead[];
      // Filter by COALESCE(stage_changed_at, updated_at) within date range
      if (fromDate || toDate) {
        list = list.filter(l => {
          const ref = (l.stage_changed_at || l.updated_at).split("T")[0];
          if (fromDate && ref < fromDate) return false;
          if (toDate && ref > toDate) return false;
          return true;
        });
      }
      if (assignedFilter !== "all") {
        list = list.filter(l => l.assigned_to === assignedFilter);
      }
      setRows(list);
    } catch (e: any) {
      toast.error(e.message || "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchWon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fromDate, toDate, assignedFilter]);

  const totalValue = useMemo(() => rows.reduce((s, l) => s + Number(l.value_in_rupees || 0), 0), [rows]);

  const handleExport = () => {
    if (!rows.length) { toast.error("Nothing to export"); return; }
    const data = rows.map(l => ({
      "Customer Name": l.customer_name,
      "Phone": l.customer_phone,
      "Category": l.category,
      "Value (₹)": Number(l.value_in_rupees || 0),
      "Assigned To": nameOf(l.assigned_to),
      "Created By": nameOf(l.created_by),
      "Won Date": (l.stage_changed_at || l.updated_at).split("T")[0],
      "Created Date": l.created_at.split("T")[0],
      "Delivery Date": l.delivery_date || "",
      "Next Follow-up": l.next_follow_up_date || "",
      "Notes": l.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // Append totals row
    XLSX.utils.sheet_add_aoa(ws, [["", "", "TOTAL", totalValue]], { origin: -1 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Won Leads");
    const range = `${fromDate || "all"}_to_${toDate || "all"}`;
    XLSX.writeFile(wb, `won_leads_${range}.xlsx`);
    toast.success(`Exported ${rows.length} won leads`);
  };

  const salesProfiles = allProfiles.filter(p => p.role === "sales" || p.role === "admin");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-success" />
            Won Leads
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant={preset === "today" ? "default" : "outline"} onClick={() => applyPreset("today")}>Today</Button>
            <Button size="sm" variant={preset === "week" ? "default" : "outline"} onClick={() => applyPreset("week")}>This Week</Button>
            <Button size="sm" variant={preset === "month" ? "default" : "outline"} onClick={() => applyPreset("month")}>This Month</Button>
            <Button size="sm" variant={preset === "fy" ? "default" : "outline"} onClick={() => applyPreset("fy")}>This FY</Button>
            <Button size="sm" variant={preset === "all" ? "default" : "outline"} onClick={() => applyPreset("all")}>All Time</Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" className="h-9" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset("custom"); }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" className="h-9" value={toDate} onChange={e => { setToDate(e.target.value); setPreset("custom"); }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Salesperson</Label>
              <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {salesProfiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleExport} className="w-full gap-2 gradient-primary" disabled={!rows.length}>
                <Download className="w-4 h-4" /> Excel
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <Badge variant="secondary">Count: {rows.length}</Badge>
            <Badge className="bg-success/10 text-success border-success/20">Total: ₹{totalValue.toLocaleString("en-IN")}</Badge>
          </div>
        </div>

        <div className="flex-1 overflow-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Value (₹)</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Won Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No won leads in this range</TableCell></TableRow>
                )}
                {rows.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.customer_name}</TableCell>
                    <TableCell className="text-xs">{l.customer_phone}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{l.category}</Badge></TableCell>
                    <TableCell className="text-right font-semibold text-success">₹{Number(l.value_in_rupees || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-xs">{nameOf(l.assigned_to)}</TableCell>
                    <TableCell className="text-xs">{(l.stage_changed_at || l.updated_at).split("T")[0]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WonLeadsDialog;

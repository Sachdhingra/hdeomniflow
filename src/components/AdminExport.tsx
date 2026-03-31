import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type ExportType = "leads" | "service_jobs" | "delivery_jobs" | "site_visits" | "all";

function toCsvString(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const AdminExport = () => {
  const { leads, serviceJobs, siteVisits, profiles } = useData();
  const { allProfiles } = useAuth();
  const [exportType, setExportType] = useState<ExportType>("leads");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const getName = (id: string | null) => {
    if (!id) return "";
    return profiles.find(p => p.id === id)?.name || allProfiles.find(p => p.id === id)?.name || "";
  };

  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");

  const filterByDate = <T extends { created_at: string }>(items: T[]) => {
    return items.filter(item => {
      const d = item.created_at.split("T")[0];
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });
  };

  const handleExport = () => {
    const types: ExportType[] = exportType === "all" ? ["leads", "service_jobs", "delivery_jobs", "site_visits"] : [exportType];

    for (const t of types) {
      let csv = "";
      let filename = `${t}_export_${dateStr}.csv`;

      if (t === "leads") {
        let filtered = filterByDate(leads);
        if (statusFilter !== "all") filtered = filtered.filter(l => l.status === statusFilter);
        if (categoryFilter !== "all") filtered = filtered.filter(l => l.category === categoryFilter);
        const headers = ["Customer Name", "Mobile", "Category", "Value (₹)", "Status", "Assigned To", "Created Date", "Follow-up Date", "Notes"];
        const rows = filtered.map(l => [
          l.customer_name, l.customer_phone, l.category, String(l.value_in_rupees),
          l.status, getName(l.assigned_to), l.created_at.split("T")[0],
          l.next_follow_up_date || "", l.notes || "",
        ]);
        csv = toCsvString(headers, rows);
      } else if (t === "service_jobs" || t === "delivery_jobs") {
        let filtered = filterByDate(serviceJobs).filter(j =>
          t === "delivery_jobs" ? j.type === "delivery" : j.type === "service"
        );
        if (statusFilter !== "all") filtered = filtered.filter(j => j.status === statusFilter);
        if (categoryFilter !== "all") filtered = filtered.filter(j => j.category === categoryFilter);
        const headers = ["Customer Name", "Mobile", "Category", "Type", "Value (₹)", "Status", "Assigned Agent", "Date to Attend", "Description", "Address"];
        const rows = filtered.map(j => [
          j.customer_name, j.customer_phone, j.category, j.type,
          String(j.value), j.status, getName(j.assigned_agent),
          j.date_to_attend || "", j.description, j.address,
        ]);
        csv = toCsvString(headers, rows);
      } else if (t === "site_visits") {
        let filtered = filterByDate(siteVisits);
        const headers = ["Agent", "Society", "Location", "Date", "Customer Name", "Phone", "Category", "Budget (₹)", "Status", "Notes"];
        const rows = filtered.map(v => [
          getName(v.agent_id), v.society, v.location, v.date,
          v.customer_name || "", v.customer_phone || "", v.category || "",
          String(v.budget || ""), v.status || "", v.notes || "",
        ]);
        csv = toCsvString(headers, rows);
      }

      if (csv) {
        downloadCsv(csv, filename);
        toast.success(`Exported ${t.replace("_", " ")}`);
      }
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />Export Data (CSV)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Export Type</Label>
            <Select value={exportType} onValueChange={v => setExportType(v as ExportType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="leads">Leads</SelectItem>
                <SelectItem value="service_jobs">Service Jobs</SelectItem>
                <SelectItem value="delivery_jobs">Delivery Jobs</SelectItem>
                <SelectItem value="site_visits">Site Visits</SelectItem>
                <SelectItem value="all">Export All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From Date</Label>
            <Input type="date" className="h-9" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To Date</Label>
            <Input type="date" className="h-9" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
                <SelectItem value="negotiation">Negotiation</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {LEAD_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="gradient-primary gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />Download CSV
        </Button>
      </CardContent>
    </Card>
  );
};

export default AdminExport;

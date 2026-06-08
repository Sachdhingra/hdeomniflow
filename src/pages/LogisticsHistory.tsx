import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileDown, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CALCULATOR_LABELS, CalculatorType, inr } from "@/lib/logistics";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function LogisticsHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("logistics_calculations" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      const list = (data as any) || [];
      setRows(list);
      const ids = Array.from(new Set(list.map((r: any) => r.created_by).filter(Boolean)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id, name").in("id", ids);
        const map: Record<string, string> = {};
        (ps || []).forEach((p: any) => (map[p.id] = p.name));
        setProfiles(map);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.calculator_type !== typeFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !(r.customer_name || "").toLowerCase().includes(s) &&
          !(r.customer_phone || "").toLowerCase().includes(s)
        )
          return false;
      }
      if (from && new Date(r.created_at) < new Date(from)) return false;
      if (to && new Date(r.created_at) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [rows, typeFilter, search, from, to]);

  function exportExcel() {
    const data = filtered.map((r) => ({
      Date: new Date(r.created_at).toLocaleString("en-IN"),
      Type: CALCULATOR_LABELS[r.calculator_type as CalculatorType] || r.calculator_type,
      Customer: r.customer_name || "—",
      Phone: r.customer_phone || "—",
      Subtotal: r.subtotal,
      GST: r.gst_amount,
      Final: r.final_amount,
      "GST included": r.gst_included ? "Yes" : "No",
      "Attached": r.attached_to_lead ? "Yes" : "No",
      "Created by": profiles[r.created_by] || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logistics");
    XLSX.writeFile(wb, `logistics-history-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF();
    doc.text("Logistics & Service Calculator — History", 14, 14);
    autoTable(doc, {
      startY: 20,
      head: [["Date", "Type", "Customer", "Final", "GST", "By"]],
      body: filtered.map((r) => [
        new Date(r.created_at).toLocaleDateString("en-IN"),
        CALCULATOR_LABELS[r.calculator_type as CalculatorType] || r.calculator_type,
        `${r.customer_name || "—"}\n${r.customer_phone || ""}`,
        inr(r.final_amount),
        r.gst_included ? "Incl." : "Excl.",
        profiles[r.created_by] || "—",
      ]),
      styles: { fontSize: 8 },
    });
    doc.save(`logistics-history-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  const canExport = user && ["admin", "accounts", "service_head"].includes(user.role);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/logistics-calculator">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Logistics history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search customer or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All calculator types</SelectItem>
                {(Object.keys(CALCULATOR_LABELS) as CalculatorType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {CALCULATOR_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={exportExcel}>
                <FileDown className="w-4 h-4 mr-1" /> Excel
              </Button>
              {canExport && (
                <Button variant="outline" size="sm" onClick={exportPdf}>
                  <FileText className="w-4 h-4 mr-1" /> PDF
                </Button>
              )}
            </div>
          </div>
          <div className="rounded border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Final</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Quote</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No records.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("en-IN")}</TableCell>
                    <TableCell>{CALCULATOR_LABELS[r.calculator_type as CalculatorType] || r.calculator_type}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{inr(r.final_amount)}</TableCell>
                    <TableCell className="text-xs">{r.gst_included ? "Incl." : "Excl."}</TableCell>
                    <TableCell className="text-xs">{profiles[r.created_by] || "—"}</TableCell>
                    <TableCell className="text-xs">{r.attached_to_lead ? "Attached" : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, FileSpreadsheet, Upload, Loader2, FileText, CheckCircle2, Edit, Download, FileCode2, Settings2 } from "lucide-react";
import {
  buildTallyCsv, downloadCsv, downloadTallyExcel, buildTallyXml, downloadXml,
  tallyFilename, loadTallySettings, type TallyPurchase,
} from "@/lib/tallyExport";
import TallySettingsDialog from "@/components/TallySettingsDialog";

type Status = "Draft" | "Confirmed" | "Tally Exported";

interface Purchase {
  id: string;
  purchase_number: string;
  supplier_name: string;
  supplier_invoice_no: string;
  purchase_date: string;
  status: Status;
  tally_import_status: "Pending" | "Exported" | "Failed";
  tally_exported_at: string | null;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  notes: string | null;
  created_at: string;
}

interface LineItem {
  id?: string;
  item_name: string;
  item_code: string;
  quantity: number;
  unit: string;
  rate: number;
  discount_percent: number;
  hsn_code: string;
  gst_percent: number;
  amount?: number;
  gst_amount?: number;
  line_total?: number;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

const blankItem = (): LineItem => ({
  item_name: "", item_code: "", quantity: 1, unit: "PCS", rate: 0,
  discount_percent: 0, hsn_code: "", gst_percent: 5,
});

function calc(li: LineItem) {
  const amount = +(li.quantity * li.rate * (1 - li.discount_percent / 100)).toFixed(2);
  const gst = +(amount * li.gst_percent / 100).toFixed(2);
  return { amount, gst_amount: gst, line_total: +(amount + gst).toFixed(2) };
}

export default function AdminCompanyPurchases() {
  const [tab, setTab] = useState<Status | "All">("All");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [tallySettingsOpen, setTallySettingsOpen] = useState(false);

  // Form state
  const [supplierName, setSupplierName] = useState("GODREJ AND BOYCE MANUFACTURING CO LTD");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<LineItem[]>([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_purchases" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setPurchases((data as any) || []);
    setLoading(false);
  }

  async function loadSuppliers() {
    const { data } = await supabase.from("suppliers" as any).select("id,name").order("name");
    setSuppliers((data as any) || []);
  }

  useEffect(() => { load(); loadSuppliers(); }, []);

  const filtered = useMemo(
    () => (tab === "All" ? purchases : purchases.filter((p) => p.status === tab)),
    [purchases, tab],
  );

  const summary = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthly = purchases.filter((p) => new Date(p.created_at) >= monthStart);
    const pending = purchases.filter((p) => p.tally_import_status === "Pending");
    const exported = purchases.filter((p) => p.tally_import_status === "Exported");
    return {
      monthCount: monthly.length,
      monthTotal: monthly.reduce((s, p) => s + Number(p.grand_total || 0), 0),
      pendingCount: pending.length,
      pendingTotal: pending.reduce((s, p) => s + Number(p.grand_total || 0), 0),
      exportedCount: exported.length,
      exportedTotal: exported.reduce((s, p) => s + Number(p.grand_total || 0), 0),
    };
  }, [purchases]);

  function resetForm() {
    setEditing(null);
    setSupplierName("GODREJ AND BOYCE MANUFACTURING CO LTD");
    setInvoiceNo("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setItems([blankItem()]);
  }

  async function openEdit(p: Purchase) {
    setEditing(p);
    setSupplierName(p.supplier_name);
    setInvoiceNo(p.supplier_invoice_no);
    setPurchaseDate(p.purchase_date);
    const { data } = await supabase
      .from("purchase_line_items" as any)
      .select("*")
      .eq("purchase_id", p.id)
      .order("sort_order");
    setItems(((data as any) || []).map((d: any) => ({
      id: d.id, item_name: d.item_name, item_code: d.item_code || "",
      quantity: Number(d.quantity), unit: d.unit, rate: Number(d.rate),
      discount_percent: Number(d.discount_percent), hsn_code: d.hsn_code || "",
      gst_percent: Number(d.gst_percent),
    })));
    setDialogOpen(true);
  }

  async function savePurchase(confirm = false) {
    if (!supplierName.trim() || !invoiceNo.trim() || !purchaseDate) {
      toast.error("Supplier, invoice number and date are required");
      return;
    }
    if (!items.length || items.some((i) => !i.item_name || i.quantity <= 0 || i.rate < 0)) {
      toast.error("Each item needs a name, quantity > 0 and rate");
      return;
    }
    setSaving(true);
    try {
      const userRes = await supabase.auth.getUser();
      let pid = editing?.id;
      if (!editing) {
        const { data, error } = await supabase.from("company_purchases" as any).insert({
          supplier_name: supplierName.trim(),
          supplier_invoice_no: invoiceNo.trim(),
          purchase_date: purchaseDate,
          status: confirm ? "Confirmed" : "Draft",
          created_by: userRes.data.user?.id,
        }).select("id").single();
        if (error) throw error;
        pid = (data as any).id;
      } else {
        const { error } = await supabase.from("company_purchases" as any).update({
          supplier_name: supplierName.trim(),
          supplier_invoice_no: invoiceNo.trim(),
          purchase_date: purchaseDate,
          status: confirm ? "Confirmed" : editing.status,
        }).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("purchase_line_items" as any).delete().eq("purchase_id", editing.id);
      }
      const rows = items.map((it, idx) => ({
        purchase_id: pid,
        item_name: it.item_name, item_code: it.item_code || null,
        quantity: it.quantity, unit: it.unit, rate: it.rate,
        discount_percent: it.discount_percent, hsn_code: it.hsn_code || null,
        gst_percent: it.gst_percent, sort_order: idx,
      }));
      const { error: liErr } = await supabase.from("purchase_line_items" as any).insert(rows);
      if (liErr) throw liErr;
      toast.success(editing ? "Purchase updated" : "Purchase created");
      setDialogOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePurchase(id: string) {
    if (!confirm("Delete this purchase?")) return;
    const { error } = await supabase.from("company_purchases" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  async function uploadPdf(file: File) {
    setExtracting(true);
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((res, rej) => {
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("extract-purchase-pdf", {
        body: { pdf_base64: base64, mime_type: file.type || "application/pdf" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = data as any;
      if (r.supplier_name) setSupplierName(r.supplier_name);
      if (r.supplier_invoice_no) setInvoiceNo(r.supplier_invoice_no);
      if (r.purchase_date) setPurchaseDate(r.purchase_date);
      if (Array.isArray(r.line_items) && r.line_items.length) {
        setItems(r.line_items.map((li: any) => ({
          item_name: li.item_name || "",
          item_code: li.item_code || "",
          quantity: Number(li.quantity) || 1,
          unit: li.unit || "PCS",
          rate: Number(li.rate) || 0,
          discount_percent: Number(li.discount_percent) || 0,
          hsn_code: li.hsn_code || "",
          gst_percent: Number(li.gst_percent) || 5,
        })));
      }
      toast.success("PDF extracted — review and save");
    } catch (e: any) {
      toast.error(e.message || "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  function buildTallyPurchase(p: Purchase, lis: any[]): TallyPurchase {
    return {
      supplier_name: p.supplier_name,
      supplier_invoice_no: p.supplier_invoice_no,
      purchase_date: p.purchase_date,
      line_items: lis.map((it: any) => ({
        item_name: it.item_name,
        item_code: it.item_code ?? "",
        hsn_code: it.hsn_code ?? "",
        quantity: Number(it.quantity),
        unit: it.unit,
        rate: Number(it.rate),
        amount: Number(it.amount),
        discount_percent: Number(it.discount_percent),
        gst_percent: Number(it.gst_percent),
        gst_amount: Number(it.gst_amount),
      })),
    };
  }

  async function exportPurchase(p: Purchase, format: "csv" | "xlsx" | "xml") {
    const { data: lis } = await supabase
      .from("purchase_line_items" as any)
      .select("*").eq("purchase_id", p.id).order("sort_order");
    const tp = buildTallyPurchase(p, (lis as any) || []);

    if (format === "csv") downloadCsv(tallyFilename(tp, "csv"), buildTallyCsv([tp]));
    else if (format === "xlsx") downloadTallyExcel(tallyFilename(tp, "xlsx"), [tp]);
    else downloadXml(tallyFilename(tp, "xml"), buildTallyXml([tp], loadTallySettings()));

    await supabase.from("company_purchases" as any).update({
      status: "Tally Exported",
      tally_import_status: "Exported",
      tally_exported_at: new Date().toISOString(),
    }).eq("id", p.id);
    toast.success("Exported & marked as Tally Exported");
    load();
  }

  async function exportSelected(format: "csv" | "xlsx" | "xml") {
    if (!selected.size) return toast.error("Select at least one purchase");
    const ids = Array.from(selected);
    const chosen = purchases.filter((p) => ids.includes(p.id));
    const { data: lis } = await supabase
      .from("purchase_line_items" as any).select("*").in("purchase_id", ids);
    const byPid = new Map<string, any[]>();
    for (const it of (lis as any) || []) {
      if (!byPid.has(it.purchase_id)) byPid.set(it.purchase_id, []);
      byPid.get(it.purchase_id)!.push(it);
    }
    const tps: TallyPurchase[] = chosen.map((p) => buildTallyPurchase(p, byPid.get(p.id) || []));
    const date = new Date().toISOString().slice(0, 10);
    if (format === "csv") downloadCsv(`Tally_Batch_${date}.csv`, buildTallyCsv(tps));
    else if (format === "xlsx") downloadTallyExcel(`Tally_Batch_${date}.xlsx`, tps);
    else downloadXml(`Tally_Batch_${date}.xml`, buildTallyXml(tps, loadTallySettings()));
    await supabase.from("company_purchases" as any).update({
      status: "Tally Exported", tally_import_status: "Exported",
      tally_exported_at: new Date().toISOString(),
    }).in("id", ids);
    setSelected(new Set());
    load();
  }

  async function markImported(id: string) {
    await supabase.from("company_purchases" as any).update({
      status: "Tally Exported", tally_import_status: "Exported",
      tally_exported_at: new Date().toISOString(),
    }).eq("id", id);
    toast.success("Marked imported");
    load();
  }

  const formTotals = useMemo(() => {
    let sub = 0, gst = 0;
    items.forEach((i) => { const c = calc(i); sub += c.amount; gst += c.gst_amount; });
    return { sub, gst, total: sub + gst };
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Company Purchases</h1>
          <p className="text-sm text-muted-foreground">Manage supplier purchases and export to Tally Prime</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" disabled={!selected.size} onClick={() => exportSelected("xml")}
            title="Recommended — imports directly into Tally Prime via Gateway → Import → Data">
            <FileCode2 className="w-4 h-4" /> Export XML
          </Button>
          <Button variant="outline" disabled={!selected.size} onClick={() => exportSelected("csv")}>
            <FileDown className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="outline" disabled={!selected.size} onClick={() => exportSelected("xlsx")}>
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </Button>
          <Button variant="ghost" size="icon" title="Tally Ledger Settings" onClick={() => setTallySettingsOpen(true)}>
            <Settings2 className="w-4 h-4" />
          </Button>
          <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
            <Plus className="w-4 h-4" /> Add Purchase
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">This Month</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.monthCount}</div>
            <div className="text-sm text-muted-foreground">{inr(summary.monthTotal)}</div>
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Pending Tally Import</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{summary.pendingCount}</div>
            <div className="text-sm text-muted-foreground">{inr(summary.pendingTotal)}</div>
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Exported to Tally</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summary.exportedCount}</div>
            <div className="text-sm text-muted-foreground">{inr(summary.exportedTotal)}</div>
          </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="All">All</TabsTrigger>
              <TabsTrigger value="Draft">Draft</TabsTrigger>
              <TabsTrigger value="Confirmed">Confirmed</TabsTrigger>
              <TabsTrigger value="Tally Exported">Tally Exported</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No purchases yet</TableCell></TableRow>
                )}
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={(c) => {
                          const next = new Set(selected);
                          c ? next.add(p.id) : next.delete(p.id);
                          setSelected(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.purchase_number}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{p.supplier_name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.supplier_invoice_no}</TableCell>
                    <TableCell>{p.purchase_date}</TableCell>
                    <TableCell className="text-right font-medium">{inr(Number(p.grand_total))}</TableCell>
                    <TableCell>
                      <Badge variant={
                        p.status === "Tally Exported" ? "default" :
                          p.status === "Confirmed" ? "secondary" : "outline"
                      }>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(p)}><Edit className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Export Tally XML (recommended)" onClick={() => exportPurchase(p, "xml")}><FileCode2 className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Download CSV" onClick={() => exportPurchase(p, "csv")}><Download className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Download Excel" onClick={() => exportPurchase(p, "xlsx")}><FileSpreadsheet className="w-4 h-4" /></Button>
                        {p.tally_import_status !== "Exported" && (
                          <Button size="icon" variant="ghost" title="Mark Imported" onClick={() => markImported(p.id)}><CheckCircle2 className="w-4 h-4" /></Button>
                        )}
                        <Button size="icon" variant="ghost" title="Delete" onClick={() => deletePurchase(p.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.purchase_number}` : "Add Purchase"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-end">
              <label className="cursor-pointer">
                <input
                  type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
                />
                <span className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm hover:bg-accent">
                  {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Upload PDF (auto-extract)
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Supplier</Label>
                <Select value={supplierName} onValueChange={setSupplierName}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                    {!suppliers.find((s) => s.name === supplierName) && supplierName && (
                      <SelectItem value={supplierName}>{supplierName}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Invoice No</Label>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </div>
            </div>

            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-left">Code</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-left">Unit</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 text-right">Disc%</th>
                    <th className="p-2 text-left">HSN</th>
                    <th className="p-2 text-right">GST%</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const c = calc(it);
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-1"><Input value={it.item_name} onChange={(e) => { const n=[...items]; n[idx]={...it,item_name:e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input value={it.item_code} onChange={(e) => { const n=[...items]; n[idx]={...it,item_code:e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="text-right w-20" type="number" value={it.quantity} onChange={(e) => { const n=[...items]; n[idx]={...it,quantity:+e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="w-20" value={it.unit} onChange={(e) => { const n=[...items]; n[idx]={...it,unit:e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="text-right w-28" type="number" value={it.rate} onChange={(e) => { const n=[...items]; n[idx]={...it,rate:+e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="text-right w-20" type="number" value={it.discount_percent} onChange={(e) => { const n=[...items]; n[idx]={...it,discount_percent:+e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="w-24" value={it.hsn_code} onChange={(e) => { const n=[...items]; n[idx]={...it,hsn_code:e.target.value}; setItems(n); }} /></td>
                        <td className="p-1"><Input className="text-right w-20" type="number" value={it.gst_percent} onChange={(e) => { const n=[...items]; n[idx]={...it,gst_percent:+e.target.value}; setItems(n); }} /></td>
                        <td className="p-2 text-right font-medium">{inr(c.line_total)}</td>
                        <td className="p-1"><Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_,i)=>i!==idx))}><Trash2 className="w-4 h-4 text-destructive" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center">
              <Button variant="outline" size="sm" onClick={() => setItems([...items, blankItem()])}>
                <Plus className="w-4 h-4" /> Add line
              </Button>
              <div className="text-right text-sm space-y-1">
                <div>Subtotal: <span className="font-medium">{inr(formTotals.sub)}</span></div>
                <div>GST: <span className="font-medium">{inr(formTotals.gst)}</span></div>
                <div className="text-lg font-bold">Total: {inr(formTotals.total)}</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="outline" disabled={saving} onClick={() => savePurchase(false)}>
              <FileText className="w-4 h-4" /> Save Draft
            </Button>
            <Button disabled={saving} onClick={() => savePurchase(true)}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TallySettingsDialog open={tallySettingsOpen} onClose={() => setTallySettingsOpen(false)} />
    </div>
  );
}

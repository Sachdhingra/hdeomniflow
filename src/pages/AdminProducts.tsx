import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Search, Loader2, Package, Upload, Download,
} from "lucide-react";

interface Category {
  id: string;
  name: string;
  is_active: boolean;
}

interface Product {
  id: string;
  sku: string;
  product_name: string;
  category_id: string | null;
  hsn_code: string | null;
  line_code: string | null;
  brand_code: string | null;
  net_price: number;
  status: string;
  deleted_at: string | null;
}

type ViewMode = "detailed" | "fast";

const emptyForm = {
  brand_code: "",
  line_code: "",
  sku: "",
  product_name: "",
  category_id: "",
  hsn_code: "",
  net_price: "",
  status: "active" as "active" | "inactive",
  sku_manually_edited: false,
};

const formatINR = (n: number) => {
  if (!n && n !== 0) return "—";
  const hasDecimals = n % 1 !== 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

const generateSKU = (brand: string, line: string) =>
  brand && line ? `${brand.trim()}-${line.trim()}` : "";

const AdminProducts = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("active");

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("products_view_mode") as ViewMode) || "detailed"
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    localStorage.setItem("products_view_mode", viewMode);
  }, [viewMode]);

  const fetchAll = async () => {
    setLoading(true);
    const [prodRes, catRes] = await Promise.all([
      (supabase as any).from("products").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      (supabase as any).from("categories").select("id,name,is_active").is("deleted_at", null).eq("is_active", true).order("name"),
    ]);

    if (prodRes.error) toast({ title: "Failed to load products", description: prodRes.error.message, variant: "destructive" });
    else setProducts((prodRes.data ?? []) as Product[]);

    if (catRes.error) toast({ title: "Failed to load categories", description: catRes.error.message, variant: "destructive" });
    else setCategories((catRes.data ?? []) as Category[]);

    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchAll();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach(c => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.sku.toLowerCase().includes(q) ||
        p.product_name.toLowerCase().includes(q) ||
        (p.line_code ?? "").toLowerCase().includes(q) ||
        (p.brand_code ?? "").toLowerCase().includes(q) ||
        (p.hsn_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search, statusFilter, categoryFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      brand_code: p.brand_code ?? "",
      line_code: p.line_code ?? "",
      sku: p.sku,
      product_name: p.product_name,
      category_id: p.category_id ?? "",
      hsn_code: p.hsn_code ?? "",
      net_price: String(p.net_price ?? ""),
      status: (p.status === "inactive" ? "inactive" : "active"),
      sku_manually_edited: true,
    });
    setDialogOpen(true);
  };

  const onBrandChange = (v: string) => {
    setForm(f => ({
      ...f,
      brand_code: v,
      sku: f.sku_manually_edited ? f.sku : generateSKU(v, f.line_code),
    }));
  };
  const onLineChange = (v: string) => {
    setForm(f => ({
      ...f,
      line_code: v,
      sku: f.sku_manually_edited ? f.sku : generateSKU(f.brand_code, v),
    }));
  };
  const onSkuChange = (v: string) => {
    setForm(f => ({ ...f, sku: v, sku_manually_edited: true }));
  };

  const ensureUniqueSku = async (sku: string, ignoreId?: string): Promise<string> => {
    let candidate = sku;
    let i = 1;
    // loop until unique
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await (supabase as any)
        .from("products")
        .select("id")
        .eq("sku", candidate)
        .is("deleted_at", null);
      const conflict = (data ?? []).filter((r: any) => r.id !== ignoreId);
      if (conflict.length === 0) return candidate;
      candidate = `${sku}_${i++}`;
    }
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) {
      toast({ title: "Product name is required", variant: "destructive" });
      return;
    }
    if (!form.category_id) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    const price = parseFloat(form.net_price);
    if (isNaN(price) || price < 0) {
      toast({ title: "Valid net price is required", variant: "destructive" });
      return;
    }
    let sku = form.sku.trim() || generateSKU(form.brand_code, form.line_code);
    if (!sku) {
      toast({ title: "SKU is required", description: "Provide brand + line code or enter SKU manually.", variant: "destructive" });
      return;
    }

    setSaving(true);
    sku = await ensureUniqueSku(sku, editing?.id);

    const payload = {
      sku,
      product_name: form.product_name.trim(),
      category_id: form.category_id,
      hsn_code: form.hsn_code.trim() || null,
      line_code: form.line_code.trim() || null,
      brand_code: form.brand_code.trim() || null,
      net_price: price,
      status: form.status,
    };

    let error;
    if (editing) {
      ({ error } = await (supabase as any).from("products").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await (supabase as any).from("products").insert({ ...payload, created_by: user!.id }));
    }
    setSaving(false);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Product updated" : "Product created", description: `SKU: ${sku}` });
    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async (p: Product) => {
    const { error } = await (supabase as any)
      .from("products")
      .update({ deleted_at: new Date().toISOString(), status: "inactive" })
      .eq("id", p.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Product deleted" });
    fetchAll();
  };

  // ---------- CSV Bulk Upload ----------
  const downloadTemplate = () => {
    const header = "brand_code,line_code,sku,product_name,category_name,hsn_code,net_price,status\n";
    const sample = "NEW2025,561015225D0,,King Size Bed,Beds,94016100,25000,active\n";
    const blob = new Blob([header + sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text: string): Record<string, string>[] => {
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
      const cols: string[] = [];
      let cur = "";
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
        else cur += ch;
      }
      cols.push(cur);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
      return row;
    });
  };

  const handleBulkUpload = async (file: File) => {
    setBulkParsing(true);
    setBulkResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "Empty CSV", variant: "destructive" });
        setBulkParsing(false);
        return;
      }

      const catByName = new Map<string, string>();
      categories.forEach(c => catByName.set(c.name.toLowerCase(), c.id));

      const errors: string[] = [];
      let success = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 2;
        try {
          const name = r["product_name"];
          const catName = r["category_name"];
          const price = parseFloat(r["net_price"] || "0");
          if (!name) { errors.push(`Row ${rowNum}: missing product_name`); continue; }
          if (!catName) { errors.push(`Row ${rowNum}: missing category_name`); continue; }
          const catId = catByName.get(catName.toLowerCase());
          if (!catId) { errors.push(`Row ${rowNum}: category "${catName}" not found`); continue; }
          if (isNaN(price) || price < 0) { errors.push(`Row ${rowNum}: invalid net_price`); continue; }

          let sku = (r["sku"] || generateSKU(r["brand_code"] || "", r["line_code"] || "")).trim();
          if (!sku) { errors.push(`Row ${rowNum}: missing sku and brand+line`); continue; }
          sku = await ensureUniqueSku(sku);

          const { error } = await (supabase as any).from("products").insert({
            sku,
            product_name: name,
            category_id: catId,
            hsn_code: r["hsn_code"] || null,
            line_code: r["line_code"] || null,
            brand_code: r["brand_code"] || null,
            net_price: price,
            status: r["status"]?.toLowerCase() === "inactive" ? "inactive" : "active",
            created_by: user!.id,
          });
          if (error) { errors.push(`Row ${rowNum}: ${error.message}`); continue; }
          success++;
        } catch (e: any) {
          errors.push(`Row ${rowNum}: ${e.message}`);
        }
      }

      setBulkResult({ success, failed: errors.length, errors: errors.slice(0, 20) });
      if (success > 0) {
        toast({ title: `Imported ${success} product(s)`, description: errors.length ? `${errors.length} row(s) failed.` : undefined });
        fetchAll();
      } else {
        toast({ title: "Import failed", description: "No rows imported.", variant: "destructive" });
      }
    } finally {
      setBulkParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Package className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Product Master</h1>
            <p className="text-sm text-muted-foreground">Full product management with live search</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => setViewMode("detailed")}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                viewMode === "detailed" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Detailed
            </button>
            <button
              onClick={() => setViewMode("fast")}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-colors ${
                viewMode === "fast" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Fast
            </button>
          </div>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="w-4 h-4" /> Bulk Upload
          </Button>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Product
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="mr-auto">All Products ({filtered.length})</CardTitle>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search SKU, name, line code..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              {search || categoryFilter !== "all" ? "No products match your filters." : "No products yet. Add your first product."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Category</TableHead>
                  {viewMode === "detailed" && <TableHead>HSN Code</TableHead>}
                  {viewMode === "detailed" && <TableHead>Line Code</TableHead>}
                  {viewMode === "detailed" && <TableHead>Brand Code</TableHead>}
                  <TableHead className="text-right">Net Price (incl. GST)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-bold text-xs">{p.sku}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="line-clamp-2">{p.product_name}</div>
                    </TableCell>
                    <TableCell>
                      {p.category_id && categoryMap.has(p.category_id) ? (
                        <Badge variant="secondary" className="font-mono text-xs">
                          {categoryMap.get(p.category_id)}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {viewMode === "detailed" && <TableCell className="text-muted-foreground text-sm">{p.hsn_code || "—"}</TableCell>}
                    {viewMode === "detailed" && <TableCell className="text-muted-foreground text-sm">{p.line_code || "—"}</TableCell>}
                    {viewMode === "detailed" && <TableCell className="text-muted-foreground text-sm">{p.brand_code || "—"}</TableCell>}
                    <TableCell className="text-right font-medium">{formatINR(Number(p.net_price))}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "secondary"}>
                        {p.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="text-primary" onClick={() => openEdit(p)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete "{p.product_name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This product will be removed. SKU: <span className="font-mono">{p.sku}</span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(p)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Product" : "Add New Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Brand Code</Label>
                <Input value={form.brand_code} onChange={(e) => onBrandChange(e.target.value)} placeholder="e.g., NEW2025" />
              </div>
              <div className="space-y-2">
                <Label>Line Code</Label>
                <Input value={form.line_code} onChange={(e) => onLineChange(e.target.value)} placeholder="e.g., 561015225D0" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={form.sku} onChange={(e) => onSkuChange(e.target.value)} placeholder="Auto-generated" className="font-mono" />
              <p className="text-xs text-muted-foreground">Auto-generated from Brand + Line code, can be edited</p>
            </div>

            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder="e.g., King Size Bed" />
            </div>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>HSN Code</Label>
                <Input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} placeholder="e.g., 94016100" />
              </div>
              <div className="space-y-2">
                <Label>Net Price (incl. GST) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.net_price}
                    onChange={(e) => setForm({ ...form, net_price: e.target.value })}
                    placeholder="0.00"
                    className="pl-7"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label className="font-medium">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive products are hidden from sales</p>
              </div>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(v) => setForm({ ...form, status: v ? "active" : "inactive" })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "Save Changes" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => { setBulkOpen(o); if (!o) setBulkResult(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Upload Products</DialogTitle>
            <DialogDescription>
              Upload a CSV with columns: brand_code, line_code, sku, product_name, category_name, hsn_code, net_price, status
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" onClick={downloadTemplate} className="w-full">
              <Download className="w-4 h-4" /> Download CSV Template
            </Button>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBulkUpload(f);
                }}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={bulkParsing}
                className="w-full"
              >
                {bulkParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {bulkParsing ? "Importing..." : "Choose CSV File"}
              </Button>
            </div>

            {bulkResult && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex gap-4 text-sm">
                  <span className="text-primary font-medium">✓ {bulkResult.success} imported</span>
                  {bulkResult.failed > 0 && <span className="text-destructive font-medium">✗ {bulkResult.failed} failed</span>}
                </div>
                {bulkResult.errors.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                    {bulkResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
                    {bulkResult.failed > bulkResult.errors.length && (
                      <div className="italic">...and {bulkResult.failed - bulkResult.errors.length} more</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminProducts;

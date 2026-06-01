import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Package, Plus, Minus, Trash2, Download, X } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "safe", label: "Safe" },
  { value: "chair", label: "Chair" },
  { value: "office_chair", label: "Office Chair" },
  { value: "wall_rack", label: "Wall Rack" },
  { value: "shoe_rack", label: "Shoe Rack" },
  { value: "other", label: "Others" },
];

interface InvProduct {
  id: string;
  name: string;
  category: string;
  description: string | null;
  photo_url: string | null;
  reorder_threshold: number;
}
interface DisplayRow { product_id: string; quantity_on_display: number }
interface PendingRow { product_id: string; quantity_pending: number }

const InventoryManager = () => {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== "admin" && user.role !== "sales") return <Navigate to="/" replace />;
  const isAdmin = user.role === "admin";

  const [products, setProducts] = useState<InvProduct[]>([]);
  const [display, setDisplay] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", category: "other", description: "", photo_url: "",
    reorder_threshold: 5, initial_qty: 0,
  });

  const load = async () => {
    setLoading(true);
    const [p, d, pd] = await Promise.all([
      supabase.from("inventory_products" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("display_inventory" as any).select("product_id, quantity_on_display"),
      supabase.from("pending_display" as any).select("product_id, quantity_pending"),
    ]);
    setProducts((p.data as any) || []);
    const dMap: Record<string, number> = {};
    ((d.data as any) || []).forEach((r: DisplayRow) => { dMap[r.product_id] = r.quantity_on_display; });
    setDisplay(dMap);
    const pMap: Record<string, number> = {};
    ((pd.data as any) || []).forEach((r: PendingRow) => { pMap[r.product_id] = r.quantity_pending; });
    setPending(pMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => filter === "all" ? products : products.filter(p => p.category === filter),
    [products, filter]
  );

  const stats = useMemo(() => {
    const total = products.length;
    const onDisplay = Object.values(display).reduce((a, b) => a + b, 0);
    const pendingTot = Object.values(pending).reduce((a, b) => a + b, 0);
    const reorder = products.filter(p => (display[p.id] ?? 0) <= p.reorder_threshold).length;
    return { total, onDisplay, pendingTot, reorder };
  }, [products, display, pending]);

  const upsertDisplay = async (productId: string, qty: number) => {
    const safe = Math.max(0, qty);
    setDisplay(prev => ({ ...prev, [productId]: safe }));
    const { error } = await supabase.from("display_inventory" as any).upsert(
      { product_id: productId, quantity_on_display: safe, last_updated: new Date().toISOString() },
      { onConflict: "product_id" }
    );
    if (error) toast.error("Failed to update display qty");
  };

  const upsertPending = async (productId: string, qty: number) => {
    const safe = Math.max(0, qty);
    setPending(prev => ({ ...prev, [productId]: safe }));
    const { error } = await supabase.from("pending_display" as any).upsert(
      { product_id: productId, quantity_pending: safe, date_marked: new Date().toISOString() },
      { onConflict: "product_id" }
    );
    if (error) toast.error("Failed to update pending qty");
  };

  const handleAdd = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const { data, error } = await supabase
      .from("inventory_products" as any)
      .insert({
        name: form.name.trim(),
        category: form.category,
        description: form.description || null,
        photo_url: form.photo_url || null,
        reorder_threshold: form.reorder_threshold,
        created_by: user.id,
      })
      .select()
      .single();
    if (error || !data) return toast.error(error?.message || "Failed to add product");
    const newId = (data as any).id;
    await supabase.from("display_inventory" as any).insert({
      product_id: newId, quantity_on_display: form.initial_qty,
    });
    await supabase.from("pending_display" as any).insert({
      product_id: newId, quantity_pending: 0,
    });
    toast.success("Product added");
    setForm({ name: "", category: "other", description: "", photo_url: "", reorder_threshold: 5, initial_qty: 0 });
    setShowAdd(false);
    load();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("inventory_products" as any).delete().eq("id", deleteId);
    if (error) return toast.error(error.message);
    toast.success("Product deleted");
    setDeleteId(null);
    load();
  };

  const exportCsv = () => {
    const rows = [
      ["Name", "Category", "Description", "Display Qty", "Pending Display", "Reorder Threshold", "Status"],
      ...products.map(p => {
        const dq = display[p.id] ?? 0;
        const pq = pending[p.id] ?? 0;
        const status = dq <= p.reorder_threshold ? "REORDER" : "OK";
        return [p.name, p.category, p.description || "", String(dq), String(pq), String(p.reorder_threshold), status];
      }),
    ];
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURI(csv);
    a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">Track on-display stock and reorder needs.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          {isAdmin && (
            <Button onClick={() => setShowAdd(s => !s)}>
              {showAdd ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              {showAdd ? "Close" : "Add Product"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Products</div><div className="text-2xl font-bold">{stats.total}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">On Display</div><div className="text-2xl font-bold">{stats.onDisplay}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Pending Display</div><div className="text-2xl font-bold">{stats.pendingTot}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Needs Reorder</div><div className="text-2xl font-bold text-destructive">{stats.reorder}</div></Card>
      </div>

      {showAdd && isAdmin && (
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">New Product</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Photo URL</Label><Input value={form.photo_url} onChange={e => setForm({ ...form, photo_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Reorder Threshold</Label><Input type="number" min={0} value={form.reorder_threshold} onChange={e => setForm({ ...form, reorder_threshold: parseInt(e.target.value) || 0 })} /></div>
            <div><Label>Initial Display Qty</Label><Input type="number" min={0} value={form.initial_qty} onChange={e => setForm({ ...form, initial_qty: parseInt(e.target.value) || 0 })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleAdd}>Save Product</Button></div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {[{ value: "all", label: "All" }, ...CATEGORIES].map(c => (
          <Button key={c.value} size="sm" variant={filter === c.value ? "default" : "outline"} onClick={() => setFilter(c.value)}>
            {c.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No products yet.</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filtered.map(p => {
            const dq = display[p.id] ?? 0;
            const pq = pending[p.id] ?? 0;
            const lowStock = dq <= p.reorder_threshold;
            const catLabel = CATEGORIES.find(c => c.value === p.category)?.label || p.category;
            return (
              <Card key={p.id} className="overflow-hidden flex flex-col">
                <div className="w-full h-40 bg-muted flex items-center justify-center">
                  {p.photo_url
                    ? <img src={p.photo_url} alt={p.name} className="w-full h-full object-cover" />
                    : <Package className="w-12 h-12 text-muted-foreground" />}
                </div>
                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold leading-tight">{p.name}</h3>
                      <p className="text-xs text-muted-foreground">{catLabel}</p>
                    </div>
                    {lowStock && <Badge variant="destructive" className="text-xs">Low Stock</Badge>}
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}

                  <div className="flex items-center justify-between border-t pt-2">
                    <span className="text-xs font-medium">Display</span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => upsertDisplay(p.id, dq - 1)}><Minus className="w-3 h-3" /></Button>
                      <Input type="number" className="h-7 w-14 text-center" value={dq} onChange={e => upsertDisplay(p.id, parseInt(e.target.value) || 0)} />
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => upsertDisplay(p.id, dq + 1)}><Plus className="w-3 h-3" /></Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Pending</span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => upsertPending(p.id, pq - 1)}><Minus className="w-3 h-3" /></Button>
                      <Input type="number" className="h-7 w-14 text-center" value={pq} onChange={e => upsertPending(p.id, parseInt(e.target.value) || 0)} />
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => upsertPending(p.id, pq + 1)}><Plus className="w-3 h-3" /></Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="text-xs text-muted-foreground">Reorder ≤ {p.reorder_threshold}</span>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={() => setDeleteId(p.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the product and its inventory rows.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InventoryManager;

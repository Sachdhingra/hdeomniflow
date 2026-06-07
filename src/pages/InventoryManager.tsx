import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Package, Search, Camera, Warehouse, Store, Truck, ClipboardList,
  CheckCircle, XCircle, Clock, Plus, Minus, RefreshCw, X, CheckSquare,
  AlertTriangle, User, Calendar, Circle, ChevronRight, Edit2,
  AlertCircle, Loader2, Filter,
} from "lucide-react";
import { toast } from "sonner";

// ─── Bucket / storage constants ───────────────────────────────────────────────
const BUCKET = "field-agent-photos";
const MAX_DIM = 1280;
const TARGET_KB = 200;
const UPLOAD_TIMEOUT = 45_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawProduct { id: string; sku: string; product_name: string; net_price: number; category_name?: string; }
interface Location { id: string; name: string; type: "warehouse" | "showroom"; }
interface InvRow { id: string; product_id: string; location_id: string; quantity: number; inventory_type: string; }
interface PhotoRow { product_id: string; photo_url: string; }

interface TrackedArticle {
  product_id: string;
  product_name: string;
  sku: string;
  net_price: number;
  category_name?: string;
  photo_url?: string;
  locs: { location_id: string; name: string; type: string; qty: number; }[];
  total: number;
}

interface HdeOrder {
  id: string; order_number: string; order_type: string; order_tag?: string;
  company_order_reason?: string; product_id: string; replacement_product_id?: string;
  location_id?: string; customer_name?: string; customer_phone?: string;
  status: string; notes?: string; custom_specs?: string; created_at: string;
  created_by: string; field_assigned_to?: string; due_date?: string;
  completed_at?: string; updated_at: string;
  product_name?: string; creator_name?: string; field_agent_name?: string;
  replacement_product_name?: string;
}

interface TimelineEntry {
  id: string; action: string; description?: string; performed_at: string; performer_name?: string;
}

interface JobPhoto { id: string; photo_type: string; photo_url: string; uploaded_at: string; }
interface Profile { id: string; name: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending Approval", approved: "Approved", rejected: "Rejected",
  service_assigned: "Service Assigned", field_assigned: "Field Assigned",
  in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
};
const STATUS_COLORS: Record<string, string> = {
  pending_approval: "bg-yellow-100 text-yellow-800 border-yellow-300",
  approved: "bg-blue-100 text-blue-800 border-blue-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
  service_assigned: "bg-purple-100 text-purple-800 border-purple-300",
  field_assigned: "bg-indigo-100 text-indigo-800 border-indigo-300",
  in_progress: "bg-orange-100 text-orange-800 border-orange-300",
  completed: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-gray-100 text-gray-700 border-gray-300",
};
const ORDER_TYPE_LABELS: Record<string, string> = {
  warehouse: "Sold via Warehouse", showroom: "Sold via Showroom", company: "Order to Company",
};
const REASON_LABELS: Record<string, string> = {
  no_stock: "No Stock Available", fresh_piece: "Fresh Piece Requested", custom: "Custom Requirement",
};

function daysSince(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }
function agingColor(d: number) { return d < 90 ? "text-green-600" : d < 180 ? "text-amber-600" : "text-red-600"; }
function agingBg(d: number) { return d < 90 ? "bg-green-50 border-green-200" : d < 180 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"; }

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// ─── Photo upload helpers (mirrors ServiceJobPhotoUpload) ─────────────────────

async function toJpegBlob(file: File, maxDim: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) { const r = Math.min(maxDim / w, maxDim / h); w = Math.round(w * r); h = Math.round(h * r); }
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob null")), "image/jpeg", quality);
      };
      img.onerror = () => reject(new Error("Decode failed"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function compress(file: File): Promise<Blob> {
  let quality = 0.75, dim = MAX_DIM;
  for (let i = 0; i < 6; i++) {
    try {
      const blob = await toJpegBlob(file, dim, quality);
      if (blob.size / 1024 <= TARGET_KB || (quality <= 0.3 && dim <= 480)) return blob;
      if (quality > 0.3) quality = Math.max(0.3, quality - 0.12);
      else dim = Math.max(480, Math.round(dim * 0.8));
    } catch { return file; }
  }
  try { return await toJpegBlob(file, 480, 0.3); } catch { return file; }
}

async function uploadPhoto(blob: Blob, path: string): Promise<string> {
  const result = await Promise.race([
    supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600", upsert: true }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout")), UPLOAD_TIMEOUT)),
  ]);
  if ((result as any).error) throw new Error((result as any).error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ─── Inline product photo uploader ───────────────────────────────────────────

function ProductPhotoCell({
  productId, currentUrl, canUpload, onUploaded,
}: { productId: string; currentUrl?: string; canUpload: boolean; onUploaded: (url: string) => void; }) {
  const [state, setState] = useState<"idle" | "uploading">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState("uploading");
    try {
      const blob = await compress(file);
      const path = `inventory/${productId}/photo_${Date.now()}.jpg`;
      const url = await uploadPhoto(blob, path);
      await supabase.from("hde_product_photos" as any).upsert({ product_id: productId, photo_url: url }, { onConflict: "product_id" });
      onUploaded(url);
      toast.success("Photo updated");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setState("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="relative w-full h-44 bg-muted flex items-center justify-center overflow-hidden">
      {currentUrl
        ? <img src={currentUrl} alt="" className="w-full h-full object-cover" />
        : <Package className="w-14 h-14 text-muted-foreground opacity-25" />
      }
      {canUpload && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={state === "uploading"}
          className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-2 transition-colors"
          title="Upload photo"
        >
          {state === "uploading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Add Article dialog (track a new product) ─────────────────────────────────

// Default locations used when hde_locations table is empty / not yet seeded
const DEFAULT_LOCATIONS: Location[] = [
  { id: "__warehouse__", name: "Warehouse", type: "warehouse" },
  { id: "__showroom1__", name: "Showroom 1", type: "showroom" },
  { id: "__showroom2__", name: "Showroom 2", type: "showroom" },
];

function AddArticleDialog({
  open, onClose, allProducts, locations, userId, onDone,
}: {
  open: boolean; onClose: () => void; allProducts: RawProduct[];
  locations: Location[]; userId: string; onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [picked, setPicked] = useState<RawProduct | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Fall back to hardcoded defaults if hde_locations not seeded yet
  const effectiveLocs = locations.length > 0 ? locations : DEFAULT_LOCATIONS;

  useEffect(() => {
    if (open) { setSearch(""); setCategoryFilter("all"); setPicked(null); setQtys({}); }
  }, [open]);

  const categories = useMemo(() => {
    const cats = [...new Set(allProducts.map(p => p.category_name).filter(Boolean))] as string[];
    return cats.sort();
  }, [allProducts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allProducts.filter(p => {
      if (categoryFilter !== "all" && p.category_name !== categoryFilter) return false;
      if (q && !p.product_name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 200);
  }, [allProducts, search, categoryFilter]);

  const handleSave = async () => {
    if (!picked) return toast.error("Select a product first");
    const hasQty = effectiveLocs.some(l => (qtys[l.id] ?? 0) > 0);
    if (!hasQty) return toast.error("Enter at least 1 unit for a location");
    setSaving(true);
    try {
      // Build list of {realId, type, qty} — handling both cases:
      // A) real locations already loaded  → qtys are keyed by real UUIDs
      // B) fallback fake IDs in use       → must create real rows first, map by index
      let pairs: { id: string; type: string; qty: number }[];

      if (locations.length > 0) {
        // Case A: use real IDs directly
        pairs = locations.map(l => ({ id: l.id, type: l.type, qty: qtys[l.id] ?? 0 }));
      } else {
        // Case B: seed locations, then map by position
        const { data: created, error: seedErr } = await supabase
          .from("hde_locations" as any)
          .insert(DEFAULT_LOCATIONS.map(l => ({ name: l.name, type: l.type })))
          .select();
        if (seedErr || !created || !(created as any).length) {
          throw new Error("Locations not configured. Ask admin to set up locations first.");
        }
        pairs = (created as any).map((loc: any, i: number) => ({
          id: loc.id,
          type: loc.type,
          qty: qtys[DEFAULT_LOCATIONS[i]?.id] ?? 0,
        }));
      }

      let saved = 0;
      for (const p of pairs) {
        if (p.qty <= 0) continue;
        const { error } = await supabase.from("hde_inventory" as any).upsert({
          product_id: picked.id,
          location_id: p.id,
          quantity: p.qty,
          inventory_type: p.type === "warehouse" ? "warehouse" : "display",
          updated_by: userId,
        }, { onConflict: "product_id,location_id" });
        if (error) throw new Error(error.message);
        saved++;
      }
      if (saved === 0) throw new Error("No quantities entered — enter at least 1 unit.");

      toast.success(`${picked.product_name} added to inventory`);
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to save. Check connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Article to Inventory</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!picked ? (
            <>
              {/* Search + Category filter */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search product name or SKU…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <Filter className="w-3 h-3 mr-1" />
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{filtered.length} product{filtered.length !== 1 ? "s" : ""} shown — tap to select</p>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {filtered.length === 0
                  ? <p className="text-sm text-muted-foreground p-3 text-center">No products match.</p>
                  : filtered.map(p => (
                    <button key={p.id} onClick={() => setPicked(p)} className="w-full text-left px-3 py-2.5 hover:bg-muted/60 border-b last:border-0 active:bg-muted">
                      <p className="text-sm font-medium leading-tight">{p.product_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.category_name && <span className="mr-2">{p.category_name}</span>}
                        <span className="font-mono">{p.sku}</span>
                        <span className="ml-2">₹{p.net_price.toLocaleString("en-IN")}</span>
                      </p>
                    </button>
                  ))
                }
              </div>
            </>
          ) : (
            <>
              {/* Selected product chip */}
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-tight">{picked.product_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {picked.category_name && <span className="mr-2">{picked.category_name}</span>}
                    <span className="font-mono">{picked.sku}</span>
                    <span className="ml-2">₹{picked.net_price.toLocaleString("en-IN")}</span>
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2" onClick={() => setPicked(null)}>
                  <X className="w-4 h-4" /> Change
                </Button>
              </div>

              {/* Location qty inputs */}
              <div className="space-y-2">
                <p className="text-sm font-semibold">Opening stock per location</p>
                {effectiveLocs.map(l => (
                  <div key={l.id} className="flex items-center gap-3 p-2 bg-muted/40 rounded-lg">
                    <span className="flex items-center gap-1.5 text-sm flex-1">
                      {l.type === "warehouse"
                        ? <Warehouse className="w-4 h-4 text-blue-600 shrink-0" />
                        : <Store className="w-4 h-4 text-emerald-600 shrink-0" />}
                      <span className="font-medium">{l.name}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"
                        onClick={() => setQtys(p => ({ ...p, [l.id]: Math.max(0, (p[l.id] ?? 0) - 1) }))}>
                        <Minus className="w-3 h-3" />
                      </Button>
                      <Input
                        type="number" min={0}
                        className="h-8 w-16 text-center font-semibold"
                        value={qtys[l.id] ?? 0}
                        onChange={e => setQtys(prev => ({ ...prev, [l.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                      />
                      <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"
                        onClick={() => setQtys(p => ({ ...p, [l.id]: (p[l.id] ?? 0) + 1 }))}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                <Button className="flex-1" onClick={handleSave} disabled={saving}>
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Adding…</> : "Add to Inventory"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Receive Stock dialog ─────────────────────────────────────────────────────

function ReceiveStockDialog({
  open, onClose, article, locations, userId, onDone,
}: {
  open: boolean; onClose: () => void; article: TrackedArticle | null;
  locations: Location[]; userId: string; onDone: () => void;
}) {
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setLocationId(""); setQty(1); } }, [open]);

  const handleSave = async () => {
    if (!article || !locationId) return toast.error("Select a location");
    if (qty <= 0) return toast.error("Quantity must be at least 1");
    setSaving(true);
    try {
      const current = article.locs.find(l => l.location_id === locationId)?.qty ?? 0;
      const locType = locations.find(l => l.id === locationId)?.type;
      const { error } = await supabase.from("hde_inventory" as any).upsert({
        product_id: article.product_id, location_id: locationId,
        quantity: current + qty,
        inventory_type: locType === "warehouse" ? "warehouse" : "display",
        updated_by: userId,
      }, { onConflict: "product_id,location_id" });
      if (error) throw new Error(error.message);
      toast.success(`+${qty} units added to stock`);
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to update stock");
    } finally {
      setSaving(false);
    }
  };

  if (!article) return null;
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Receive Stock</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="font-medium text-sm">{article.product_name}</p>
            <p className="text-xs text-muted-foreground">{article.sku}</p>
          </div>
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} (current: {article.locs.find(x => x.location_id === l.id)?.qty ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Units Received</Label>
            <Input type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Receive"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Order dialog ──────────────────────────────────────────────────────

function CreateOrderDialog({
  open, onClose, mode, article, allProducts, locations, userId, onCreated,
}: {
  open: boolean; onClose: () => void; mode: "warehouse" | "showroom" | "company" | null;
  article: TrackedArticle | null; allProducts: RawProduct[]; locations: Location[];
  userId: string; onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [locationId, setLocationId] = useState("");
  const [soldQty, setSoldQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [customSpecs, setCustomSpecs] = useState("");
  const [companyReason, setCompanyReason] = useState("");
  const [replacementProductId, setReplacementProductId] = useState("");
  const [replacementSearch, setReplacementSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCustomerName(""); setCustomerPhone(""); setLocationId(""); setSoldQty(1); setNotes(""); setCustomSpecs(""); setCompanyReason(""); setReplacementProductId(""); setReplacementSearch(""); }
  }, [open]);

  const filteredReplacement = useMemo(() => {
    if (!replacementSearch) return allProducts.slice(0, 20);
    const q = replacementSearch.toLowerCase();
    return allProducts.filter(p => p.product_name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 20);
  }, [allProducts, replacementSearch]);

  const locationOptions = mode === "warehouse" ? locations.filter(l => l.type === "warehouse") : locations.filter(l => l.type === "showroom");

  const handleCreate = async () => {
    if (!article || !mode) return;
    if (mode === "company" && !companyReason) return toast.error("Select a reason");
    if (mode === "showroom" && !replacementProductId) return toast.error("Select replacement product");
    if (!locationId) return toast.error("Select a location");
    if ((mode === "warehouse" || mode === "showroom") && soldQty < 1) return toast.error("Quantity must be at least 1");
    const availableQty = article.locs.find(l => l.location_id === locationId)?.qty ?? 0;
    if ((mode === "warehouse" || mode === "showroom") && soldQty > availableQty) return toast.error(`Only ${availableQty} unit${availableQty !== 1 ? "s" : ""} available at this location`);

    setSaving(true);

    const orderTag = mode === "company"
      ? ({ no_stock: "stock_out_order", fresh_piece: "fresh_piece_order", custom: "custom_order" } as any)[companyReason]
      : undefined;

    const numRes = await supabase.rpc("generate_hde_order_number" as any);
    const orderNum = numRes.data || `HDE-${Date.now()}`;

    const { data, error } = await supabase.from("hde_orders" as any).insert({
      order_number: orderNum, order_type: mode,
      company_order_reason: companyReason || null, order_tag: orderTag || null,
      product_id: article.product_id, replacement_product_id: replacementProductId || null,
      location_id: locationId, customer_name: customerName || null, customer_phone: customerPhone || null,
      status: "pending_approval", notes: notes || null, custom_specs: customSpecs || null, created_by: userId,
      qty_sold: (mode === "warehouse" || mode === "showroom") ? soldQty : 1,
    }).select().single();

    if (error || !data) { setSaving(false); return toast.error(error?.message || "Failed"); }

    const orderId = (data as any).id;

    // ── Auto-deduct inventory by sold qty ─────────────────────────────────
    if (mode === "warehouse" || mode === "showroom") {
      const currentQty = article.locs.find(l => l.location_id === locationId)?.qty ?? 0;
      await supabase.from("hde_inventory" as any)
        .update({ quantity: Math.max(0, currentQty - soldQty), updated_by: userId })
        .eq("product_id", article.product_id)
        .eq("location_id", locationId);
    }

    const qtyNote = (mode === "warehouse" || mode === "showroom") ? ` — Qty: ${soldQty}` : "";
    await supabase.from("hde_order_timeline" as any).insert({
      order_id: orderId, action: "Order Created",
      description: `${ORDER_TYPE_LABELS[mode]} — ${article.product_name}${companyReason ? ` (${REASON_LABELS[companyReason]})` : ""}${qtyNote}`,
      performed_by: userId,
    });

    if (mode === "showroom") {
      await supabase.from("hde_display_items" as any).insert({
        product_id: article.product_id, location_id: locationId,
        display_status: "sold", replacement_product_id: replacementProductId,
        order_id: orderId, updated_by: userId,
      });
    }

    setSaving(false);
    toast.success(`Order ${orderNum} created`);
    onCreated();
    onClose();
  };

  if (!article || !mode) return null;
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "warehouse" && <span className="flex items-center gap-2"><Warehouse className="w-4 h-4 text-blue-600" />Sold via Warehouse</span>}
            {mode === "showroom" && <span className="flex items-center gap-2"><Store className="w-4 h-4 text-emerald-600" />Sold via Showroom</span>}
            {mode === "company" && <span className="flex items-center gap-2"><Truck className="w-4 h-4" />Order to Company</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-semibold">{article.product_name}</p>
            <p className="text-xs text-muted-foreground">{article.sku} · ₹{article.net_price.toLocaleString("en-IN")}</p>
          </div>

          {mode === "company" && (
            <div className="space-y-2">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Select value={companyReason} onValueChange={setCompanyReason}>
                <SelectTrigger><SelectValue placeholder="Select reason…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_stock">No Stock Available</SelectItem>
                  <SelectItem value="fresh_piece">Fresh Piece Requested by Customer</SelectItem>
                  <SelectItem value="custom">Custom Requirement</SelectItem>
                </SelectContent>
              </Select>
              {companyReason === "custom" && (
                <Textarea value={customSpecs} onChange={e => setCustomSpecs(e.target.value)} placeholder="Custom fabric, colour, size, specs…" rows={3} />
              )}
            </div>
          )}

          <div>
            <Label>Location <span className="text-destructive">*</span></Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locationOptions.map(l => {
                  const currentQty = article.locs.find(x => x.location_id === l.id)?.qty ?? 0;
                  return <SelectItem key={l.id} value={l.id}>{l.name} (stock: {currentQty})</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>

          {(mode === "warehouse" || mode === "showroom") && (
            <div>
              <Label>Quantity Sold <span className="text-destructive">*</span></Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  min={1}
                  max={article.locs.find(l => l.location_id === locationId)?.qty ?? 9999}
                  value={soldQty}
                  onChange={e => setSoldQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-28"
                />
                {locationId && (
                  <span className="text-xs text-muted-foreground">
                    Available: <strong>{article.locs.find(l => l.location_id === locationId)?.qty ?? 0}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {mode === "showroom" && (
            <div>
              <Label>Replacement Product <span className="text-destructive">*</span></Label>
              <Input placeholder="Search replacement…" value={replacementSearch} onChange={e => setReplacementSearch(e.target.value)} className="mb-2" />
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {filteredReplacement.map(p => (
                  <button key={p.id} onClick={() => { setReplacementProductId(p.id); setReplacementSearch(p.product_name); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0 ${replacementProductId === p.id ? "bg-blue-50" : ""}`}>
                    <span className="font-medium">{p.product_name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{p.sku}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Customer Name</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></div>
            <div><Label>Customer Phone</Label><Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Order"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Order Detail dialog ──────────────────────────────────────────────────────

function OrderDetailDialog({
  order, open, onClose, userId, userRole, fieldAgents, onUpdated,
}: {
  order: HdeOrder | null; open: boolean; onClose: () => void; userId: string;
  userRole: string; fieldAgents: Profile[]; onUpdated: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoType, setPhotoType] = useState<"before" | "after" | "other">("before");

  useEffect(() => {
    if (!open || !order) return;
    setLoading(true);
    Promise.all([
      supabase.from("hde_order_timeline" as any).select("*, profiles(name)").eq("order_id", order.id).order("performed_at"),
      supabase.from("hde_job_photos" as any).select("*").eq("order_id", order.id).order("uploaded_at"),
    ]).then(([t, p]) => {
      setTimeline(((t.data as any) || []).map((r: any) => ({ ...r, performer_name: r.profiles?.name })));
      setPhotos((p.data as any) || []);
      setLoading(false);
    });
  }, [open, order]);

  const log = async (action: string, desc: string) => {
    await supabase.from("hde_order_timeline" as any).insert({ order_id: order!.id, action, description: desc, performed_by: userId });
  };

  const handleApprove = async () => {
    setSaving(true);
    await supabase.from("hde_orders" as any).update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId }).eq("id", order!.id);
    await log("Approved by Accounts", actionNote || "Order approved");
    setSaving(false); toast.success("Approved"); onUpdated(); onClose();
  };

  const handleReject = async () => {
    if (!actionNote) return toast.error("Provide rejection reason");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: userId, rejection_reason: actionNote }).eq("id", order!.id);
    await log("Rejected by Accounts", actionNote);
    setSaving(false); toast.success("Rejected"); onUpdated(); onClose();
  };

  const handleAssign = async () => {
    if (!selectedAgent) return toast.error("Select field agent");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({
      status: "field_assigned", field_assigned_to: selectedAgent,
      field_assigned_at: new Date().toISOString(), service_assigned_at: new Date().toISOString(),
      service_assigned_by: userId, due_date: dueDate || null,
    }).eq("id", order!.id);
    const agentName = fieldAgents.find(a => a.id === selectedAgent)?.name || "agent";
    await log("Field Agent Assigned", `Assigned to ${agentName}. ${actionNote}`.trim());
    setSaving(false); toast.success("Assigned"); onUpdated(); onClose();
  };

  const handleComplete = async () => {
    if (photos.length === 0) return toast.error("Upload at least one photo first");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({ status: "completed", completed_at: new Date().toISOString(), completed_by: userId }).eq("id", order!.id);
    if (order!.order_type === "showroom") {
      await supabase.from("hde_display_items" as any).update({ display_status: "installed", updated_by: userId }).eq("order_id", order!.id);
    }
    await log("Job Completed", actionNote || "Work marked complete");
    setSaving(false); toast.success("Completed"); onUpdated(); onClose();
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !order) return;
    setPhotoUploading(true);
    try {
      const blob = await compress(file);
      const path = `jobs/${order.id}/${photoType}_${Date.now()}.jpg`;
      const url = await uploadPhoto(blob, path);
      await supabase.from("hde_job_photos" as any).insert({ order_id: order.id, photo_type: photoType, photo_url: url, uploaded_by: userId });
      await log("Photo Uploaded", `${photoType} photo uploaded`);
      const { data } = await supabase.from("hde_job_photos" as any).select("*").eq("order_id", order.id).order("uploaded_at");
      setPhotos((data as any) || []);
      toast.success("Photo uploaded");
    } catch (err: any) { toast.error(err.message || "Upload failed"); }
    finally { setPhotoUploading(false); if (photoInputRef.current) photoInputRef.current.value = ""; }
  };

  if (!order) return null;
  const canApprove = userRole === "accounts" || userRole === "admin";
  const canAssign = userRole === "service_head" || userRole === "admin";
  const canComplete = userRole === "field_agent" || userRole === "admin";

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4" />{order.order_number}<StatusBadge status={order.status} />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3 space-y-1">
              <p className="font-semibold">{order.product_name}</p>
              <p className="text-muted-foreground">{ORDER_TYPE_LABELS[order.order_type]}</p>
              {order.order_tag && <Badge variant="outline" className="text-xs">{order.order_tag.replace(/_/g, " ")}</Badge>}
            </div>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1">
              {order.customer_name && <p><span className="font-medium">Customer:</span> {order.customer_name}</p>}
              {order.customer_phone && <p><span className="font-medium">Phone:</span> {order.customer_phone}</p>}
              <p className="text-xs text-muted-foreground">Created: {new Date(order.created_at).toLocaleDateString("en-IN")}</p>
              {order.due_date && <p className="text-xs">Due: {new Date(order.due_date).toLocaleDateString("en-IN")}</p>}
            </div>
          </div>
          {order.notes && <div className="text-sm bg-muted/30 rounded p-2"><b>Notes:</b> {order.notes}</div>}
          {order.custom_specs && <div className="text-sm bg-muted/30 rounded p-2"><b>Custom Specs:</b> {order.custom_specs}</div>}
          {order.replacement_product_name && <div className="text-sm bg-blue-50 rounded p-2"><b>Replacement:</b> {order.replacement_product_name}</div>}

          {/* Timeline */}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Clock className="w-4 h-4" />Timeline</h4>
            {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : timeline.length === 0 ? <p className="text-sm text-muted-foreground">No entries yet.</p> : (
              <div className="pl-4 space-y-3">
                {timeline.map((t, i) => (
                  <div key={t.id} className="relative">
                    <div className="absolute -left-2 top-1 w-3 h-3 rounded-full bg-primary" />
                    {i < timeline.length - 1 && <div className="absolute -left-0.5 top-4 bottom-0 w-px bg-border" />}
                    <div className="ml-3">
                      <p className="text-sm font-medium">{t.action}</p>
                      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                      <p className="text-xs text-muted-foreground">{t.performer_name} · {new Date(t.performed_at).toLocaleString("en-IN")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photos */}
          {photos.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Camera className="w-4 h-4" />Photos</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(ph => (
                  <div key={ph.id} className="relative">
                    <img src={ph.photo_url} alt={ph.photo_type} className="w-full h-24 object-cover rounded border" />
                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1 rounded">{ph.photo_type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photo upload */}
          {(canComplete || canAssign) && !["completed","rejected","cancelled"].includes(order.status) && (
            <div className="border rounded-lg p-3 space-y-2">
              <h4 className="text-sm font-semibold">Upload Photo</h4>
              <div className="flex gap-2 items-center">
                <Select value={photoType} onValueChange={v => setPhotoType(v as any)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">Before</SelectItem>
                    <SelectItem value="after">After</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}>
                  {photoUploading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Uploading…</> : <><Camera className="w-3 h-3 mr-1" />Choose Photo</>}
                </Button>
                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border rounded-lg p-3 space-y-3">
            <h4 className="text-sm font-semibold">Actions</h4>
            <Textarea placeholder="Comment / note…" value={actionNote} onChange={e => setActionNote(e.target.value)} rows={2} />
            {canApprove && order.status === "pending_approval" && (
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleApprove} disabled={saving}><CheckCircle className="w-4 h-4 mr-1" />Approve</Button>
                <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={saving}><XCircle className="w-4 h-4 mr-1" />Reject</Button>
              </div>
            )}
            {canAssign && ["approved","service_assigned"].includes(order.status) && (
              <div className="space-y-2">
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger><SelectValue placeholder="Select field agent…" /></SelectTrigger>
                  <SelectContent>{fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="flex-1" />
                  <Button onClick={handleAssign} disabled={saving}><User className="w-4 h-4 mr-1" />Assign</Button>
                </div>
              </div>
            )}
            {canComplete && order.status === "field_assigned" && (
              <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleComplete} disabled={saving}>
                <CheckSquare className="w-4 h-4 mr-1" />Mark Complete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Orders list view ─────────────────────────────────────────────────────────

function OrdersView({ orders, onSelect, onRefresh }: { orders: HdeOrder[]; onSelect: (o: HdeOrder) => void; onRefresh: () => void; }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() =>
    orders.filter(o =>
      (statusFilter === "all" || o.status === statusFilter) &&
      (!search || o.order_number.toLowerCase().includes(search.toLowerCase()) || (o.product_name || "").toLowerCase().includes(search.toLowerCase()) || (o.customer_name || "").toLowerCase().includes(search.toLowerCase()))
    ), [orders, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search orders…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={onRefresh}><RefreshCw className="w-4 h-4" /></Button>
      </div>
      <p className="text-sm text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</p>
      <div className="space-y-2">
        {filtered.length === 0
          ? <Card className="p-8 text-center text-muted-foreground"><ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No orders found.</p></Card>
          : filtered.map(o => {
            const d = daysSince(o.created_at);
            const open = !["completed","cancelled","rejected"].includes(o.status);
            return (
              <Card key={o.id} className={`p-4 cursor-pointer hover:shadow-md transition-shadow border ${open ? agingBg(d) : ""}`} onClick={() => onSelect(o)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{o.order_number}</span>
                      <StatusBadge status={o.status} />
                      <span className="text-xs px-2 py-0.5 rounded bg-muted border text-muted-foreground">{ORDER_TYPE_LABELS[o.order_type]}</span>
                      {o.order_tag && <span className="text-xs px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-orange-700">{o.order_tag.replace(/_/g, " ")}</span>}
                    </div>
                    <p className="text-sm mt-1 font-medium truncate">{o.product_name}</p>
                    {o.customer_name && <p className="text-xs text-muted-foreground">Customer: {o.customer_name}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("en-IN")}</p>
                    {open && <p className={`text-xs font-medium mt-1 ${agingColor(d)}`}>{d}d open</p>}
                    <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 ml-auto" />
                  </div>
                </div>
              </Card>
            );
          })}
      </div>
    </div>
  );
}

// ─── Field jobs view ──────────────────────────────────────────────────────────

function FieldJobsView({ orders, userId, onSelect }: { orders: HdeOrder[]; userId: string; onSelect: (o: HdeOrder) => void; }) {
  const mine = useMemo(() => orders.filter(o => o.field_assigned_to === userId && !["completed","cancelled"].includes(o.status)), [orders, userId]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{mine.length} assigned job{mine.length !== 1 ? "s" : ""}</p>
      {mine.length === 0
        ? <Card className="p-12 text-center text-muted-foreground"><CheckSquare className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No jobs assigned.</p></Card>
        : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mine.map(o => {
            const d = daysSince(o.created_at);
            return (
              <Card key={o.id} className={`p-4 cursor-pointer hover:shadow-md transition-shadow border ${agingBg(d)}`} onClick={() => onSelect(o)}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">{o.order_number}</p>
                    <p className="text-sm font-medium mt-1">{o.product_name}</p>
                    {o.customer_name && <p className="text-xs text-muted-foreground"><User className="inline w-3 h-3 mr-1" />{o.customer_name}</p>}
                    {o.due_date && <p className="text-xs text-muted-foreground"><Calendar className="inline w-3 h-3 mr-1" />{new Date(o.due_date).toLocaleDateString("en-IN")}</p>}
                  </div>
                  <div className="text-right"><StatusBadge status={o.status} /><p className={`text-xs font-medium mt-1 ${agingColor(d)}`}>{d}d</p></div>
                </div>
                <Button size="sm" className="w-full mt-3" onClick={e => { e.stopPropagation(); onSelect(o); }}>
                  <Camera className="w-3 h-3 mr-1" />Upload Photos & Update
                </Button>
              </Card>
            );
          })}
        </div>}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ orders, articles }: { orders: HdeOrder[]; articles: TrackedArticle[]; }) {
  const s = useMemo(() => ({
    totalArticles: articles.length,
    totalUnits: articles.reduce((a, b) => a + b.total, 0),
    pendingApproval: orders.filter(o => o.status === "pending_approval").length,
    fieldAssigned: orders.filter(o => o.status === "field_assigned").length,
    completed: orders.filter(o => o.status === "completed").length,
    warehouse: orders.filter(o => o.order_type === "warehouse").length,
    showroom: orders.filter(o => o.order_type === "showroom").length,
    company: orders.filter(o => o.order_type === "company").length,
    stockOut: orders.filter(o => o.order_tag === "stock_out_order").length,
    freshPiece: orders.filter(o => o.order_tag === "fresh_piece_order").length,
    custom: orders.filter(o => o.order_tag === "custom_order").length,
    alert90: orders.filter(o => !["completed","cancelled","rejected"].includes(o.status) && daysSince(o.created_at) >= 90 && daysSince(o.created_at) < 180).length,
    alert180: orders.filter(o => !["completed","cancelled","rejected"].includes(o.status) && daysSince(o.created_at) >= 180).length,
  }), [orders, articles]);

  const cards = [
    { label: "Total Articles", value: s.totalArticles, color: "text-primary", bg: "bg-primary/5" },
    { label: "Total Units", value: s.totalUnits, color: "text-primary", bg: "bg-primary/5" },
    { label: "Pending Approval", value: s.pendingApproval, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "Field Assigned", value: s.fieldAssigned, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Completed", value: s.completed, color: "text-green-600", bg: "bg-green-50" },
    { label: "Via Warehouse", value: s.warehouse, color: "text-cyan-600", bg: "bg-cyan-50" },
    { label: "Via Showroom", value: s.showroom, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Company Orders", value: s.company, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Stock Out", value: s.stockOut, color: "text-red-600", bg: "bg-red-50" },
    { label: "Fresh Piece", value: s.freshPiece, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Custom Orders", value: s.custom, color: "text-pink-600", bg: "bg-pink-50" },
    { label: "90-Day Alerts", value: s.alert90, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "180-Day Alerts", value: s.alert180, color: "text-red-700", bg: "bg-red-100" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <Card key={c.label} className={`p-4 ${c.bg}`}>
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
        </Card>
      ))}
    </div>
  );
}

// ─── Stock table (admin) ──────────────────────────────────────────────────────

function StockTable({ articles, locations, userId, onRefresh }: { articles: TrackedArticle[]; locations: Location[]; userId: string; onRefresh: () => void; }) {
  const [editKey, setEditKey] = useState<string | null>(null); // "productId::locationId"
  const [editQty, setEditQty] = useState(0);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editKey) return;
    const [productId, locationId] = editKey.split("::");
    setSaving(true);
    const locType = locations.find(l => l.id === locationId)?.type;
    await supabase.from("hde_inventory" as any).upsert(
      { product_id: productId, location_id: locationId, quantity: editQty, inventory_type: locType === "warehouse" ? "warehouse" : "display", updated_by: userId },
      { onConflict: "product_id,location_id" }
    );
    setSaving(false);
    setEditKey(null);
    onRefresh();
    toast.success("Updated");
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Article</TableHead>
            <TableHead>SKU</TableHead>
            {locations.map(l => <TableHead key={l.id}>{l.name}</TableHead>)}
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {articles.map(a => (
            <TableRow key={a.product_id}>
              <TableCell className="font-medium text-sm">{a.product_name}</TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">{a.sku}</TableCell>
              {locations.map(l => {
                const qty = a.locs.find(x => x.location_id === l.id)?.qty ?? 0;
                const k = `${a.product_id}::${l.id}`;
                const editing = editKey === k;
                return (
                  <TableCell key={l.id}>
                    {editing ? (
                      <div className="flex items-center gap-1">
                        <Input type="number" min={0} value={editQty} onChange={e => setEditQty(parseInt(e.target.value) || 0)} className="h-7 w-16 text-center" />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save} disabled={saving}><CheckCircle className="w-3 h-3 text-green-600" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditKey(null)}><X className="w-3 h-3" /></Button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditKey(k); setEditQty(qty); }} className="flex items-center gap-1 hover:text-primary">
                        <span className={`font-semibold ${qty === 0 ? "text-red-400" : ""}`}>{qty}</span>
                        <Edit2 className="w-3 h-3 opacity-30" />
                      </button>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="font-bold">{a.total}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InventoryManager() {
  const { user } = useAuth();
  if (!user) return null;

  const role = user.role as string;
  if (!["admin","sales","service_head","accounts","field_agent","site_agent"].includes(role)) return <Navigate to="/" replace />;

  const isAdmin = role === "admin";
  const isSales = role === "sales" || role === "site_agent";
  const isAccounts = role === "accounts";
  const isServiceHead = role === "service_head";
  const isFieldAgent = role === "field_agent";
  const canUploadPhoto = isAdmin || isSales;

  const [allProducts, setAllProducts] = useState<RawProduct[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [photoRows, setPhotoRows] = useState<PhotoRow[]>([]);
  const [orders, setOrders] = useState<HdeOrder[]>([]);
  const [fieldAgents, setFieldAgents] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [addArticleOpen, setAddArticleOpen] = useState(false);
  const [receiveArticle, setReceiveArticle] = useState<TrackedArticle | null>(null);
  const [sellMode, setSellMode] = useState<"warehouse" | "showroom" | "company" | null>(null);
  const [sellArticle, setSellArticle] = useState<TrackedArticle | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<HdeOrder | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [search, setSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats, locs, inv, photos, ords, agents] = await Promise.all([
        supabase.from("products" as any)
          .select("id, sku, product_name, net_price, category_id")
          .eq("status", "active").is("deleted_at", null)
          .order("product_name").limit(2000),
        supabase.from("categories" as any)
          .select("id, name").is("deleted_at", null),
        supabase.from("hde_locations" as any).select("*").eq("is_active", true).order("name"),
        supabase.from("hde_inventory" as any).select("*").limit(5000),
        supabase.from("hde_product_photos" as any).select("product_id, photo_url"),
        supabase.from("hde_orders" as any)
          .select("*, products(product_name), profiles!hde_orders_created_by_fkey(name), replacement:products!hde_orders_replacement_product_id_fkey(product_name), field_agent:profiles!hde_orders_field_assigned_to_fkey(name)")
          .order("created_at", { ascending: false }).limit(500),
        supabase.from("profiles" as any)
          .select("id, name, user_roles!inner(role)").eq("user_roles.role", "field_agent"),
      ]);

      const catMap = new Map<string, string>(((cats.data as any) || []).map((c: any) => [c.id, c.name]));
      setAllProducts(((prods.data as any) || []).map((p: any) => ({ ...p, category_name: catMap.get(p.category_id) })));
      setLocations((locs.data as any) || []);
      setInvRows((inv.data as any) || []);
      setPhotoRows((photos.data as any) || []);
      setOrders(((ords.data as any) || []).map((o: any) => ({
        ...o,
        product_name: o.products?.product_name,
        creator_name: o.profiles?.name,
        field_agent_name: o.field_agent?.name,
        replacement_product_name: o.replacement?.product_name,
      })));
      setFieldAgents((agents.data as any) || []);
    } catch (err: any) {
      toast.error("Failed to load inventory: " + (err?.message || "unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Build tracked articles: products that have at least one inventory row
  const trackedArticles = useMemo<TrackedArticle[]>(() => {
    const productMap = new Map(allProducts.map(p => [p.id, p]));
    const photoMap = new Map(photoRows.map(p => [p.product_id, p.photo_url]));
    const grouped = new Map<string, InvRow[]>();
    invRows.forEach(r => {
      if (!grouped.has(r.product_id)) grouped.set(r.product_id, []);
      grouped.get(r.product_id)!.push(r);
    });
    const articles: TrackedArticle[] = [];
    grouped.forEach((rows, productId) => {
      const prod = productMap.get(productId);
      const locs = rows.map(r => {
        const loc = locations.find(l => l.id === r.location_id);
        return { location_id: r.location_id, name: loc?.name || "—", type: loc?.type || "warehouse", qty: r.quantity };
      });
      articles.push({
        product_id: productId,
        product_name: prod?.product_name || `[Product ${productId.slice(0, 8)}]`,
        sku: prod?.sku || productId.slice(0, 8),
        net_price: prod?.net_price || 0,
        category_name: prod?.category_name,
        photo_url: photoMap.get(productId),
        locs,
        total: locs.reduce((a, b) => a + b.qty, 0),
      });
    });
    return articles.sort((a, b) => a.product_name.localeCompare(b.product_name));
  }, [allProducts, invRows, photoRows, locations]);

  const filteredArticles = useMemo(() => {
    if (!search) return trackedArticles;
    const q = search.toLowerCase();
    return trackedArticles.filter(a => a.product_name.toLowerCase().includes(q) || a.sku.toLowerCase().includes(q));
  }, [trackedArticles, search]);

  const updatePhoto = (productId: string, url: string) => {
    setPhotoRows(prev => {
      const existing = prev.findIndex(p => p.product_id === productId);
      if (existing >= 0) { const n = [...prev]; n[existing] = { product_id: productId, photo_url: url }; return n; }
      return [...prev, { product_id: productId, photo_url: url }];
    });
  };

  const pendingCount = orders.filter(o => o.status === "pending_approval").length;
  const myJobsCount = orders.filter(o => o.field_assigned_to === user.id && !["completed","cancelled"].includes(o.status)).length;

  const tabs = [
    { value: "catalogue", label: "Articles", show: true },
    { value: "orders", label: `Orders${pendingCount > 0 && (isAccounts || isAdmin) ? ` (${pendingCount})` : ""}`, show: !isFieldAgent },
    { value: "jobs", label: `My Jobs${myJobsCount > 0 ? ` (${myJobsCount})` : ""}`, show: isFieldAgent || isAdmin },
    { value: "dashboard", label: "Dashboard", show: isAdmin || isServiceHead || isAccounts },
    { value: "stock", label: "Stock Table", show: isAdmin || isAccounts || isServiceHead },
  ].filter(t => t.show);

  const defaultTab = isFieldAgent ? "jobs" : "catalogue";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-primary" />Inventory</h1>
          <p className="text-sm text-muted-foreground">Display articles, stock levels and fulfillment</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(isAdmin || isSales || isAccounts) && (
            <Button variant="outline" size="sm" onClick={() => setAddArticleOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />Add Article
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
          <span className="text-muted-foreground">Loading…</span>
        </div>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            {tabs.map(t => <TabsTrigger key={t.value} value={t.value} className="text-xs">{t.label}</TabsTrigger>)}
          </TabsList>

          {/* ── Articles catalogue ── */}
          <TabsContent value="catalogue" className="mt-4 space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search article or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="text-sm text-muted-foreground flex items-center">{filteredArticles.length} article{filteredArticles.length !== 1 ? "s" : ""} tracked</div>
            </div>

            {filteredArticles.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-25" />
                <p className="font-medium">No articles in inventory yet</p>
                <p className="text-xs mt-1">Use "Add Article" to start tracking your first product.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredArticles.map(a => (
                  <Card key={a.product_id} className="overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                    {/* Photo — sales + admin can upload */}
                    <ProductPhotoCell
                      productId={a.product_id}
                      currentUrl={a.photo_url}
                      canUpload={canUploadPhoto}
                      onUploaded={url => updatePhoto(a.product_id, url)}
                    />

                    <CardContent className="p-3 flex-1 flex flex-col gap-2">
                      <div>
                        <h3 className="font-semibold text-sm leading-tight line-clamp-2">{a.product_name}</h3>
                        <p className="text-xs text-muted-foreground font-mono">{a.sku}</p>
                        {a.category_name && <p className="text-xs text-muted-foreground">{a.category_name}</p>}
                      </div>
                      <div className="text-base font-bold text-primary">₹{a.net_price.toLocaleString("en-IN")}</div>

                      {/* Stock per location */}
                      <div className="bg-muted/50 rounded-lg p-2 space-y-1">
                        {a.locs.map(l => (
                          <div key={l.location_id} className="flex justify-between text-xs">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              {l.type === "warehouse" ? <Warehouse className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                              {l.name}
                            </span>
                            <span className={`font-semibold ${l.qty === 0 ? "text-red-500" : "text-foreground"}`}>{l.qty}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs border-t pt-1 mt-1">
                          <span className="text-muted-foreground font-medium">Total</span>
                          <span className="font-bold">{a.total}</span>
                        </div>
                      </div>

                      {/* Receive stock button */}
                      {(isAdmin || isSales || isAccounts) && (
                        <Button size="sm" variant="outline" className="w-full text-xs h-7"
                          onClick={() => setReceiveArticle(a)}>
                          <Plus className="w-3 h-3 mr-1" />Receive Stock
                        </Button>
                      )}

                      {/* Sale actions */}
                      {!isFieldAgent && (
                        <div className="flex flex-col gap-1 mt-auto">
                          <Button size="sm" className="w-full text-xs h-7 bg-blue-600 hover:bg-blue-700" onClick={() => { setSellArticle(a); setSellMode("warehouse"); }}>
                            <Warehouse className="w-3 h-3 mr-1" />Sold via Warehouse
                          </Button>
                          <Button size="sm" className="w-full text-xs h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setSellArticle(a); setSellMode("showroom"); }}>
                            <Store className="w-3 h-3 mr-1" />Sold via Showroom
                          </Button>
                          <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={() => { setSellArticle(a); setSellMode("company"); }}>
                            <Truck className="w-3 h-3 mr-1" />Order to Company
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Orders ── */}
          <TabsContent value="orders" className="mt-4">
            <OrdersView orders={orders} onSelect={o => { setSelectedOrder(o); setOrderDetailOpen(true); }} onRefresh={loadAll} />
          </TabsContent>

          {/* ── Field jobs ── */}
          <TabsContent value="jobs" className="mt-4">
            <FieldJobsView orders={orders} userId={user.id} onSelect={o => { setSelectedOrder(o); setOrderDetailOpen(true); }} />
          </TabsContent>

          {/* ── Dashboard ── */}
          <TabsContent value="dashboard" className="mt-4">
            <DashboardView orders={orders} articles={trackedArticles} />
          </TabsContent>

          {/* ── Stock table ── */}
          <TabsContent value="stock" className="mt-4">
            <StockTable articles={trackedArticles} locations={locations} userId={user.id} onRefresh={loadAll} />
          </TabsContent>
        </Tabs>
      )}

      {/* Dialogs */}
      <AddArticleDialog open={addArticleOpen} onClose={() => setAddArticleOpen(false)} allProducts={allProducts} locations={locations} userId={user.id} onDone={loadAll} />
      <ReceiveStockDialog open={!!receiveArticle} onClose={() => setReceiveArticle(null)} article={receiveArticle} locations={locations} userId={user.id} onDone={loadAll} />
      <CreateOrderDialog open={!!sellMode} onClose={() => { setSellMode(null); setSellArticle(null); }} mode={sellMode} article={sellArticle} allProducts={allProducts} locations={locations} userId={user.id} onCreated={loadAll} />
      <OrderDetailDialog order={selectedOrder} open={orderDetailOpen} onClose={() => { setOrderDetailOpen(false); setSelectedOrder(null); }} userId={user.id} userRole={role} fieldAgents={fieldAgents} onUpdated={loadAll} />
    </div>
  );
}

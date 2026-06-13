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
  AlertCircle, Loader2, Filter, Trash2, Shield,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

// ─── Bucket / storage constants ───────────────────────────────────────────────
const BUCKET = "field-agent-photos";
const MAX_DIM = 1280;
const TARGET_KB = 200;
const UPLOAD_TIMEOUT = 45_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawProduct { id: string; sku: string; product_name: string; net_price: number; category_name?: string; }
interface Location { id: string; name: string; type: "warehouse" | "showroom"; }
interface InvRow { id: string; product_id: string; location_id: string; quantity: number; inventory_type: string; group_id?: string | null; updated_at?: string; updated_by?: string | null; }
interface PhotoRow { product_id: string; photo_url: string; }

interface LocEntry { location_id: string; name: string; type: string; qty: number; updated_at?: string; updated_by?: string | null; }

interface TrackedArticlePart {
  product_id: string;
  product_name: string;
  sku: string;
  net_price: number;
  locs: LocEntry[];
  total: number;
}

interface TrackedArticle {
  group_id?: string;
  product_id: string;
  product_name: string;
  sku: string;
  net_price: number;
  category_name?: string;
  photo_url?: string;
  locs: LocEntry[];
  total: number;
  parts?: TrackedArticlePart[];
}

interface PickedItem {
  product: RawProduct;
  qtys: Record<string, number>;
}

interface HdeOrder {
  id: string; order_number: string; order_type: string; order_tag?: string;
  company_order_reason?: string; product_id: string; replacement_product_id?: string;
  replacement_product_ids?: string[];
  location_id?: string; customer_name?: string; customer_phone?: string;
  status: string; notes?: string; custom_specs?: string; created_at: string;
  created_by: string; field_assigned_to?: string; due_date?: string;
  completed_at?: string; updated_at: string;
  product_name?: string; creator_name?: string; field_agent_name?: string;
  replacement_product_name?: string; replacement_product_names?: string[];
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
  const [enlarged, setEnlarged] = useState(false);
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
    <>
      <div className="relative w-full h-44 bg-muted flex items-center justify-center overflow-hidden">
        {currentUrl ? (
          <img
            src={currentUrl} alt=""
            className="w-full h-full object-cover cursor-zoom-in"
            onClick={() => setEnlarged(true)}
            title="Click to enlarge"
          />
        ) : (
          <Package className="w-14 h-14 text-muted-foreground opacity-25" />
        )}
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

      {enlarged && currentUrl && (
        <Dialog open={enlarged} onOpenChange={setEnlarged}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0">
            <img src={currentUrl} alt="Full size" className="w-full h-auto max-h-[85vh] object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
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
  const [phase, setPhase] = useState<"search" | "configure">("search");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [pickedItems, setPickedItems] = useState<PickedItem[]>([]);
  const [sharedPhotoBlob, setSharedPhotoBlob] = useState<Blob | null>(null);
  const [sharedPhotoPreview, setSharedPhotoPreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const effectiveLocs = locations.length > 0 ? locations : DEFAULT_LOCATIONS;

  useEffect(() => {
    if (open) {
      setPhase("search");
      setSearch("");
      setCategoryFilter("all");
      setPickedItems([]);
      setSharedPhotoBlob(null);
      setSharedPhotoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return ""; });
    }
  }, [open]);

  const categories = useMemo(() => {
    const cats = [...new Set(allProducts.map(p => p.category_name).filter(Boolean))] as string[];
    return cats.sort();
  }, [allProducts]);

  const pickedIds = useMemo(() => new Set(pickedItems.map(i => i.product.id)), [pickedItems]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allProducts.filter(p => {
      if (pickedIds.has(p.id)) return false;
      if (categoryFilter !== "all" && p.category_name !== categoryFilter) return false;
      if (q && !p.product_name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 200);
  }, [allProducts, search, categoryFilter, pickedIds]);

  const pickProduct = (product: RawProduct) => {
    setPickedItems(prev => [...prev, { product, qtys: {} }]);
    setPhase("configure");
  };

  const removeItem = (id: string) => {
    setPickedItems(prev => {
      const next = prev.filter(i => i.product.id !== id);
      if (next.length === 0) setPhase("search");
      return next;
    });
  };

  const setQty = (productId: string, locationId: string, qty: number) => {
    setPickedItems(prev => prev.map(i =>
      i.product.id === productId ? { ...i, qtys: { ...i.qtys, [locationId]: Math.max(0, qty) } } : i
    ));
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    try {
      const blob = await compress(file);
      setSharedPhotoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setSharedPhotoBlob(blob);
    } catch { toast.error("Failed to process photo"); }
    finally { setPhotoUploading(false); if (photoRef.current) photoRef.current.value = ""; }
  };

  const handleSave = async () => {
    if (pickedItems.length === 0) return toast.error("Add at least one product");
    const hasAnyQty = pickedItems.some(item => effectiveLocs.some(l => (item.qtys[l.id] ?? 0) > 0));
    if (!hasAnyQty) return toast.error("Enter at least 1 unit for any product/location");
    setSaving(true);
    try {
      let pairs: { id: string; type: string; fakeId: string }[];
      if (locations.length > 0) {
        pairs = locations.map(l => ({ id: l.id, type: l.type, fakeId: l.id }));
      } else {
        const { data: created, error: seedErr } = await supabase
          .from("hde_locations" as any)
          .insert(DEFAULT_LOCATIONS.map(l => ({ name: l.name, type: l.type })))
          .select();
        if (seedErr || !created || !(created as any).length)
          throw new Error("Locations not configured. Ask admin to set up locations first.");
        pairs = (created as any).map((loc: any, i: number) => ({
          id: loc.id, type: loc.type, fakeId: DEFAULT_LOCATIONS[i]?.id ?? loc.id,
        }));
      }

      let sharedPhotoUrl: string | null = null;
      if (sharedPhotoBlob) {
        const path = `inventory/${pickedItems[0].product.id}/shared_${Date.now()}.jpg`;
        sharedPhotoUrl = await uploadPhoto(sharedPhotoBlob, path);
      }

      // Assign a shared group_id when saving multiple products together
      const group_id = pickedItems.length > 1 ? crypto.randomUUID() : undefined;

      for (const item of pickedItems) {
        for (const p of pairs) {
          const qty = item.qtys[p.fakeId] ?? 0;
          if (qty <= 0) continue;
          const payload: any = {
            product_id: item.product.id, location_id: p.id, quantity: qty,
            inventory_type: p.type === "warehouse" ? "warehouse" : "display",
            updated_by: userId,
            ...(group_id ? { group_id } : {}),
          };
          let { error } = await supabase.from("hde_inventory" as any).upsert(payload, { onConflict: "product_id,location_id" });
          // If group_id column hasn't been migrated yet, retry without it
          if (error?.message?.includes("group_id")) {
            const { error: e2 } = await supabase.from("hde_inventory" as any).upsert(
              { product_id: item.product.id, location_id: p.id, quantity: qty, inventory_type: payload.inventory_type, updated_by: userId },
              { onConflict: "product_id,location_id" }
            );
            error = e2;
          }
          if (error) throw new Error(`${item.product.product_name}: ${error.message}`);
        }
        if (sharedPhotoUrl) {
          await supabase.from("hde_product_photos" as any).upsert(
            { product_id: item.product.id, photo_url: sharedPhotoUrl, uploaded_by: userId },
            { onConflict: "product_id" }
          );
        }
      }

      toast.success(`${pickedItems.length} product${pickedItems.length > 1 ? "s" : ""} added to inventory`);
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {phase === "search" && pickedItems.length > 0 ? "Add Another Product" : "Add Articles to Inventory"}
          </DialogTitle>
        </DialogHeader>

        {/* ── SEARCH PHASE ── */}
        {phase === "search" && (
          <div className="space-y-3">
            {pickedItems.length > 0 && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setPhase("configure")}>
                ← Back to form ({pickedItems.length} product{pickedItems.length !== 1 ? "s" : ""} added)
              </Button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search product name or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" autoFocus />
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
            <p className="text-xs text-muted-foreground">{filtered.length} product{filtered.length !== 1 ? "s" : ""} — tap to add</p>
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              {filtered.length === 0
                ? <p className="text-sm text-muted-foreground p-3 text-center">No products match.</p>
                : filtered.map(p => (
                  <button key={p.id} onClick={() => pickProduct(p)} className="w-full text-left px-3 py-2.5 hover:bg-muted/60 border-b last:border-0 active:bg-muted">
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
          </div>
        )}

        {/* ── CONFIGURE PHASE ── */}
        {phase === "configure" && (
          <div className="space-y-4">
            {pickedItems.map(item => (
              <div key={item.product.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-tight">{item.product.product_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.product.category_name && <span className="mr-2">{item.product.category_name}</span>}
                      <span className="font-mono">{item.product.sku}</span>
                      <span className="ml-2">₹{item.product.net_price.toLocaleString("en-IN")}</span>
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 h-7 w-7 p-0" title="Remove" onClick={() => removeItem(item.product.id)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {effectiveLocs.map(l => (
                    <div key={l.id} className="flex items-center gap-2 bg-muted/30 rounded p-1.5">
                      <span className="flex items-center gap-1.5 text-xs flex-1 font-medium">
                        {l.type === "warehouse"
                          ? <Warehouse className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          : <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                        {l.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7 shrink-0"
                          onClick={() => setQty(item.product.id, l.id, (item.qtys[l.id] ?? 0) - 1)}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <Input
                          type="number" min={0}
                          className="h-7 w-14 text-center text-sm font-semibold"
                          value={item.qtys[l.id] ?? 0}
                          onChange={e => setQty(item.product.id, l.id, parseInt(e.target.value) || 0)}
                        />
                        <Button size="icon" variant="outline" className="h-7 w-7 shrink-0"
                          onClick={() => setQty(item.product.id, l.id, (item.qtys[l.id] ?? 0) + 1)}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full" onClick={() => { setSearch(""); setPhase("search"); }}>
              <Plus className="w-4 h-4 mr-1" />Add Another Product (e.g. another part of same set)
            </Button>

            {/* Shared group photo */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Camera className="w-4 h-4" />Group Photo
                <span className="text-xs font-normal text-muted-foreground">— optional, shared across all products above</span>
              </p>
              {sharedPhotoPreview ? (
                <div className="relative">
                  <img src={sharedPhotoPreview} alt="Preview" className="w-full h-36 object-cover rounded border" />
                  <Button variant="destructive" size="sm" className="absolute top-1 right-1 h-6 w-6 p-0"
                    onClick={() => { setSharedPhotoBlob(null); URL.revokeObjectURL(sharedPhotoPreview); setSharedPhotoPreview(""); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="w-full" onClick={() => photoRef.current?.click()} disabled={photoUploading}>
                  {photoUploading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Processing…</> : <><Camera className="w-3 h-3 mr-1" />Upload Group Photo</>}
                </Button>
              )}
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Adding…</>
                  : pickedItems.length > 1 ? `Add ${pickedItems.length} Products` : "Add to Inventory"}
              </Button>
            </div>
          </div>
        )}
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
  const [partId, setPartId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  const isSet = !!(article?.parts?.length);
  const activePart = isSet ? article!.parts!.find(p => p.product_id === partId) : null;
  const effectiveProductId = isSet ? partId : article?.product_id;
  const effectiveLocs = isSet ? (activePart?.locs ?? []) : (article?.locs ?? []);

  useEffect(() => {
    if (open) { setPartId(""); setLocationId(""); setQty(1); }
  }, [open]);

  const handleSave = async () => {
    if (!article) return;
    if (isSet && !partId) return toast.error("Select which part to receive");
    if (!locationId) return toast.error("Select a location");
    if (qty <= 0) return toast.error("Quantity must be at least 1");
    setSaving(true);
    try {
      const current = effectiveLocs.find(l => l.location_id === locationId)?.qty ?? 0;
      const locType = locations.find(l => l.id === locationId)?.type;
      const { error } = await supabase.from("hde_inventory" as any).upsert({
        product_id: effectiveProductId, location_id: locationId,
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
            <p className="text-xs text-muted-foreground font-mono">{article.sku}</p>
          </div>

          {/* Part picker for sets */}
          {isSet && (
            <div>
              <Label>Which part?</Label>
              <Select value={partId} onValueChange={v => { setPartId(v); setLocationId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select part…" /></SelectTrigger>
                <SelectContent>
                  {article.parts!.map(p => (
                    <SelectItem key={p.product_id} value={p.product_id}>
                      {p.product_name} <span className="font-mono text-muted-foreground ml-1">{p.sku}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={isSet && !partId}>
              <SelectTrigger><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} (current: {effectiveLocs.find(x => x.location_id === l.id)?.qty ?? 0})
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
  const [replacementProductIds, setReplacementProductIds] = useState<string[]>([]);
  const [replacementSearch, setReplacementSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCustomerName(""); setCustomerPhone(""); setLocationId(""); setSoldQty(1); setNotes(""); setCustomSpecs(""); setCompanyReason(""); setReplacementProductIds([]); setReplacementSearch(""); }
  }, [open]);

  const filteredReplacement = useMemo(() => {
    const excluded = new Set(replacementProductIds);
    if (!replacementSearch) return allProducts.filter(p => !excluded.has(p.id)).slice(0, 20);
    const q = replacementSearch.toLowerCase();
    return allProducts.filter(p => !excluded.has(p.id) && (p.product_name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))).slice(0, 20);
  }, [allProducts, replacementSearch, replacementProductIds]);

  const locationOptions = mode === "warehouse" ? locations.filter(l => l.type === "warehouse") : locations.filter(l => l.type === "showroom");

  const handleCreate = async () => {
    if (!article || !mode) return;
    if (mode === "company" && !companyReason) return toast.error("Select a reason");
    if (mode === "showroom" && replacementProductIds.length === 0) return toast.error("Select at least one replacement product");
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

    const orderPayload: any = {
      order_number: orderNum, order_type: mode,
      company_order_reason: companyReason || null, order_tag: orderTag || null,
      product_id: article.product_id,
      replacement_product_id: replacementProductIds[0] || null,
      replacement_product_ids: replacementProductIds.length > 0 ? replacementProductIds : null,
      location_id: locationId, customer_name: customerName || null, customer_phone: customerPhone || null,
      status: "pending_approval", notes: notes || null, custom_specs: customSpecs || null, created_by: userId,
      qty_sold: (mode === "warehouse" || mode === "showroom") ? soldQty : 1,
    };

    let { data, error } = await supabase.from("hde_orders" as any).insert(orderPayload).select().single();
    if (error?.message?.includes("replacement_product_ids")) {
      const { replacement_product_ids: _, ...fallbackPayload } = orderPayload;
      const res2 = await supabase.from("hde_orders" as any).insert(fallbackPayload).select().single();
      data = res2.data; error = res2.error;
    }
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
        display_status: "sold", replacement_product_id: replacementProductIds[0] || null,
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
              {replacementProductIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 mt-1">
                  {replacementProductIds.map(id => {
                    const p = allProducts.find(x => x.id === id);
                    return (
                      <div key={id} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 text-xs max-w-full">
                        <span className="font-medium truncate">{p?.product_name || id}</span>
                        <span className="text-muted-foreground shrink-0">{p?.sku}</span>
                        <button onClick={() => setReplacementProductIds(ids => ids.filter(x => x !== id))} className="shrink-0 ml-0.5 text-muted-foreground hover:text-destructive leading-none">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <Input placeholder="Search to add replacement…" value={replacementSearch} onChange={e => setReplacementSearch(e.target.value)} className="mb-2" />
              {(replacementSearch || replacementProductIds.length === 0) && (
                <div className="border rounded-lg max-h-40 overflow-y-auto">
                  {filteredReplacement.length === 0
                    ? <p className="px-3 py-2 text-sm text-muted-foreground">No products found</p>
                    : filteredReplacement.map(p => (
                      <button key={p.id} onClick={() => { setReplacementProductIds(ids => [...ids, p.id]); setReplacementSearch(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0">
                        <span className="font-medium">{p.product_name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{p.sku}</span>
                      </button>
                    ))}
                </div>
              )}
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

// ─── Request Product dialog (sales pull from warehouse, no inventory needed) ──

function RequestProductDialog({
  open, onClose, allProducts, userId, onCreated,
}: {
  open: boolean; onClose: () => void; allProducts: RawProduct[]; userId: string; onCreated: () => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<RawProduct | null>(null);
  const [reason, setReason] = useState<string>("no_stock");
  const [customSpecs, setCustomSpecs] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSearch(""); setPicked(null); setReason("no_stock"); setCustomSpecs(""); setCustomerName(""); setCustomerPhone(""); setNotes(""); }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return allProducts.slice(0, 30);
    return allProducts.filter(p => p.product_name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 30);
  }, [allProducts, search]);

  const handleCreate = async () => {
    if (!picked) return toast.error("Pick a product first");
    if (!reason) return toast.error("Select a reason");
    setSaving(true);
    try {
      const numRes = await supabase.rpc("generate_hde_order_number" as any);
      const orderNum = numRes.data || `HDE-${Date.now()}`;
      const orderTag = ({ no_stock: "stock_out_order", fresh_piece: "fresh_piece_order", custom: "custom_order" } as any)[reason];

      const payload: any = {
        order_number: orderNum, order_type: "company",
        company_order_reason: reason, order_tag: orderTag,
        product_id: picked.id, status: "pending_approval",
        customer_name: customerName || null, customer_phone: customerPhone || null,
        notes: notes || null, custom_specs: customSpecs || null,
        created_by: userId, qty_sold: 1,
      };
      const { data, error } = await supabase.from("hde_orders" as any).insert(payload).select().single();
      if (error || !data) throw new Error(error?.message || "Failed");

      await supabase.from("hde_order_timeline" as any).insert({
        order_id: (data as any).id, action: "Order Created",
        description: `Warehouse request — ${picked.product_name} (${REASON_LABELS[reason]})`,
        performed_by: userId,
      });
      toast.success(`Request ${orderNum} created`);
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="w-4 h-4" />Request Product from Warehouse</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pull any product from the catalogue — no need to first add it to inventory. Creates a pending warehouse/company order for accounts approval.
          </p>

          {!picked ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search product name or SKU…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
              </div>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">No products found</p>
                ) : filtered.map(p => (
                  <button key={p.id} onClick={() => setPicked(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0">
                    <div className="font-medium">{p.product_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.sku} · ₹{p.net_price.toLocaleString("en-IN")}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="bg-muted/50 rounded-lg p-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{picked.product_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{picked.sku} · ₹{picked.net_price.toLocaleString("en-IN")}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}><X className="w-4 h-4" /></Button>
              </div>

              <div className="space-y-2">
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_stock">No Stock Available</SelectItem>
                    <SelectItem value="fresh_piece">Fresh Piece Requested by Customer</SelectItem>
                    <SelectItem value="custom">Custom Requirement</SelectItem>
                  </SelectContent>
                </Select>
                {reason === "custom" && (
                  <Textarea value={customSpecs} onChange={e => setCustomSpecs(e.target.value)} placeholder="Custom fabric, colour, size, specs…" rows={2} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Customer Name</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></div>
                <div><Label>Customer Phone</Label><Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !picked}>{saving ? "Creating…" : "Create Request"}</Button>
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
      supabase.from("hde_order_timeline" as any).select("*").eq("order_id", order.id).order("performed_at"),
      supabase.from("hde_job_photos" as any).select("*").eq("order_id", order.id).order("uploaded_at"),
    ]).then(async ([t, p]) => {
      const tl = (t.data as any) || [];
      const ids = Array.from(new Set(tl.map((r: any) => r.performed_by).filter(Boolean))) as string[];
      let pmap = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles" as any).select("id, name").in("id", ids);
        pmap = new Map(((profs as any) || []).map((x: any) => [x.id, x.name]));
      }
      setTimeline(tl.map((r: any) => ({ ...r, performer_name: pmap.get(r.performed_by) || "Unknown" })));
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
  const canComplete = userRole === "field_agent" || userRole === "admin" || userRole === "service_head";

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
          {(order.replacement_product_names?.length ?? 0) > 0 && (
            <div className="text-sm bg-blue-50 rounded p-2">
              <b>Replacement{(order.replacement_product_names!.length > 1) ? "s" : ""}:</b>{" "}
              {order.replacement_product_names!.join(" + ")}
            </div>
          )}

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

function OrdersView({ orders, onSelect, onRefresh, isAdmin, userId }: { orders: HdeOrder[]; onSelect: (o: HdeOrder) => void; onRefresh: () => void; isAdmin: boolean; userId: string; }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteOrder(o: HdeOrder) {
    setDeletingId(o.id);
    try {
      const { error } = await supabase.from("hde_orders" as any).delete().eq("id", o.id);
      if (error) throw error;
      await supabase.from("deletion_logs" as any).insert({
        record_type: "hde_order",
        record_id: o.id,
        deleted_by: userId,
        reason: `Admin deleted order ${o.order_number}`,
        snapshot: o as any,
      });
      toast.success(`Order ${o.order_number} deleted`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete order");
    } finally {
      setDeletingId(null);
    }
  }

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
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("en-IN")}</p>
                    {open && <p className={`text-xs font-medium ${agingColor(d)}`}>{d}d open</p>}
                    <div className="flex items-center gap-1 mt-1">
                      {isAdmin && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={e => e.stopPropagation()}
                              disabled={deletingId === o.id}
                            >
                              {deletingId === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={e => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete order {o.order_number}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes the order record. Inventory already deducted will NOT be restored automatically. This action is logged.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteOrder(o)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Delete Order
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
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

function StockTable({ articles, locations, userId, isAdmin, userMap, onRefresh }: { articles: TrackedArticle[]; locations: Location[]; userId: string; isAdmin: boolean; userMap: Map<string, string>; onRefresh: () => void; }) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState<string>("all");
  const [addedByFilter, setAddedByFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<"all" | "fresh" | "90" | "180">("all");

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

  const deleteArticle = async (productId: string, productName: string) => {
    setDeleting(productId);
    try {
      const { error } = await supabase.from("hde_inventory" as any).delete().eq("product_id", productId);
      if (error) throw error;
      toast.success(`${productName} removed from inventory`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  // Flatten group articles to individual rows for the stock view
  const flatRows = useMemo(
    () => articles.flatMap(a => a.parts
      ? a.parts.map(p => ({ ...p, group_id: a.group_id, photo_url: a.photo_url, category_name: a.category_name } as TrackedArticle))
      : [a]),
    [articles]
  );

  const daysOld = (iso?: string | null) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  };

  // Unique added-by users present across stock
  const addedByOptions = useMemo(() => {
    const ids = new Set<string>();
    flatRows.forEach(a => a.locs.forEach(l => { if (l.updated_by) ids.add(l.updated_by); }));
    return Array.from(ids).map(id => ({ id, name: userMap.get(id) || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [flatRows, userMap]);

  const visibleLocations = useMemo(
    () => locFilter === "all" ? locations : locations.filter(l => l.id === locFilter),
    [locations, locFilter]
  );

  // Determine if a row passes filters
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flatRows.filter(a => {
      if (q && !a.product_name.toLowerCase().includes(q) && !a.sku.toLowerCase().includes(q)) return false;
      // Consider only cells in visible locations
      const cells = visibleLocations.map(l => a.locs.find(x => x.location_id === l.id)).filter(Boolean) as LocEntry[];
      if (addedByFilter !== "all" && !cells.some(c => c.qty > 0 && c.updated_by === addedByFilter)) return false;
      if (ageFilter !== "all") {
        const hasMatch = cells.some(c => {
          if (c.qty <= 0) return false;
          const d = daysOld(c.updated_at);
          if (d === null) return ageFilter === "fresh";
          if (ageFilter === "fresh") return d < 90;
          if (ageFilter === "90") return d >= 90 && d < 180;
          if (ageFilter === "180") return d >= 180;
          return false;
        });
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [flatRows, search, visibleLocations, addedByFilter, ageFilter]);

  const ageBadge = (iso?: string | null, qty?: number) => {
    if (!qty || qty <= 0) return null;
    const d = daysOld(iso);
    if (d === null) return null;
    if (d >= 180) return <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">{d}d</Badge>;
    if (d >= 90) return <Badge className="ml-1 h-4 px-1 text-[10px] bg-orange-500 hover:bg-orange-500 text-white">{d}d</Badge>;
    return <span className="ml-1 text-[10px] text-muted-foreground">{d}d</span>;
  };

  const downloadCsv = () => {
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = ["Article", "SKU", "Location", "Quantity", "Added By", "Last Updated", "Days Old", "Ageing Bucket"];
    const rows: string[][] = [];
    filteredRows.forEach(a => {
      visibleLocations.forEach(l => {
        const c = a.locs.find(x => x.location_id === l.id);
        const qty = c?.qty ?? 0;
        if (qty <= 0 && ageFilter !== "all") return;
        const d = daysOld(c?.updated_at);
        const bucket = d === null ? "—" : d >= 180 ? "180+ days" : d >= 90 ? "90-179 days" : "Fresh";
        rows.push([
          a.product_name, a.sku, l.name, String(qty),
          c?.updated_by ? (userMap.get(c.updated_by) || "Unknown") : "—",
          c?.updated_at ? new Date(c.updated_at).toLocaleDateString("en-IN") : "—",
          d === null ? "—" : String(d), bucket,
        ]);
      });
    });
    const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search by name or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-7 text-sm" />
        </div>
        <Select value={locFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={addedByFilter} onValueChange={setAddedByFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Added by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All staff</SelectItem>
            {addedByOptions.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={ageFilter} onValueChange={v => setAgeFilter(v as any)}>
          <SelectTrigger className="h-9 w-[150px] text-sm"><SelectValue placeholder="Ageing" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ages</SelectItem>
            <SelectItem value="fresh">Fresh (&lt;90d)</SelectItem>
            <SelectItem value="90">90-179 days</SelectItem>
            <SelectItem value="180">180+ days</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={downloadCsv} className="h-9 gap-1">
          <ClipboardList className="w-3.5 h-3.5" /> CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{filteredRows.length} article{filteredRows.length !== 1 ? "s" : ""}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-500" />90-179d</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-destructive" />180+d (aged)</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article</TableHead>
              <TableHead>SKU</TableHead>
              {visibleLocations.map(l => <TableHead key={l.id}>{l.name}</TableHead>)}
              <TableHead>Total</TableHead>
              {isAdmin && <TableHead className="text-right">Admin</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map(a => (
              <TableRow key={a.product_id}>
                <TableCell className="font-medium text-sm">{a.product_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{a.sku}</TableCell>
                {visibleLocations.map(l => {
                  const cell = a.locs.find(x => x.location_id === l.id);
                  const qty = cell?.qty ?? 0;
                  const k = `${a.product_id}::${l.id}`;
                  const editing = editKey === k;
                  const tip = cell?.updated_at
                    ? `Updated ${new Date(cell.updated_at).toLocaleDateString("en-IN")}${cell.updated_by ? " by " + (userMap.get(cell.updated_by) || "Unknown") : ""}`
                    : "No history";
                  return (
                    <TableCell key={l.id}>
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} value={editQty} onChange={e => setEditQty(parseInt(e.target.value) || 0)} className="h-7 w-16 text-center" />
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save} disabled={saving}><CheckCircle className="w-3 h-3 text-green-600" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditKey(null)}><X className="w-3 h-3" /></Button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditKey(k); setEditQty(qty); }} title={tip} className="flex items-center gap-1 hover:text-primary">
                          <span className={`font-semibold ${qty === 0 ? "text-red-400" : ""}`}>{qty}</span>
                          {ageBadge(cell?.updated_at, qty)}
                          <Edit2 className="w-3 h-3 opacity-30" />
                        </button>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="font-bold">{a.total}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" disabled={deleting === a.product_id}>
                          {deleting === a.product_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove from inventory?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will delete all stock rows for <strong>{a.product_name}</strong> across every location. The product itself stays in the price list.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteArticle(a.product_id, a.product_name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleLocations.length + (isAdmin ? 4 : 3)} className="text-center text-sm text-muted-foreground py-8">
                  No stock matches the current filters
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const [addArticleOpen, setAddArticleOpen] = useState(false);
  const [receiveArticle, setReceiveArticle] = useState<TrackedArticle | null>(null);
  const [sellMode, setSellMode] = useState<"warehouse" | "showroom" | "company" | null>(null);
  const [sellArticle, setSellArticle] = useState<TrackedArticle | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<HdeOrder | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [requestProductOpen, setRequestProductOpen] = useState(false);
  const [search, setSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch ALL active products in batches (Supabase caps at 1000/req).
      const fetchAllProducts = async () => {
        const batch = 1000;
        let offset = 0;
        const all: any[] = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data, error } = await supabase.from("products" as any)
            .select("id, sku, product_name, net_price, category_id")
            .eq("status", "active").is("deleted_at", null)
            .order("product_name").range(offset, offset + batch - 1);
          if (error || !data) break;
          all.push(...data);
          if (data.length < batch) break;
          offset += batch;
        }
        return all;
      };

      const [prodList, cats, locs, inv, photos, ords, agentRoles] = await Promise.all([
        fetchAllProducts(),
        supabase.from("categories" as any)
          .select("id, name").is("deleted_at", null),
        supabase.from("hde_locations" as any).select("*").eq("is_active", true).order("name"),
        supabase.from("hde_inventory" as any).select("*").limit(5000),
        supabase.from("hde_product_photos" as any).select("product_id, photo_url"),
        supabase.from("hde_orders" as any)
          .select("*, products!hde_orders_product_id_fkey(product_name), replacement:products!hde_orders_replacement_product_id_fkey(product_name)")
          .order("created_at", { ascending: false }).limit(500),
        supabase.from("user_roles" as any).select("user_id").eq("role", "field_agent"),
      ]);

      const catMap = new Map<string, string>(((cats.data as any) || []).map((c: any) => [c.id, c.name]));
      setAllProducts((prodList || []).map((p: any) => ({ ...p, category_name: catMap.get(p.category_id) })));
      setLocations((locs.data as any) || []);
      setInvRows((inv.data as any) || []);
      setPhotoRows((photos.data as any) || []);

      const ordList = (ords.data as any) || [];
      const userIds = new Set<string>();
      ordList.forEach((o: any) => {
        [o.created_by, o.field_assigned_to, o.approved_by, o.rejected_by, o.service_assigned_by, o.completed_by]
          .forEach((id: string | null) => { if (id) userIds.add(id); });
      });
      const agentIds: string[] = ((agentRoles.data as any) || []).map((r: any) => r.user_id);
      agentIds.forEach(id => userIds.add(id));
      // include inventory editors
      ((inv.data as any) || []).forEach((r: any) => { if (r.updated_by) userIds.add(r.updated_by); });

      let profMap = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: profs } = await supabase.from("profiles" as any)
          .select("id, name").in("id", Array.from(userIds));
        profMap = new Map(((profs as any) || []).map((p: any) => [p.id, p.name]));
      }
      setUserMap(profMap);

      const prodNameMap = new Map((prodList || []).map((p: any) => [p.id, p.product_name as string]));
      setOrders(ordList.map((o: any) => {
        const replacementNames: string[] = o.replacement_product_ids?.length
          ? o.replacement_product_ids.map((id: string) => prodNameMap.get(id)).filter(Boolean)
          : o.replacement?.product_name ? [o.replacement.product_name] : [];
        return {
          ...o,
          product_name: o.products?.product_name,
          creator_name: profMap.get(o.created_by),
          field_agent_name: o.field_assigned_to ? profMap.get(o.field_assigned_to) : undefined,
          replacement_product_name: replacementNames[0],
          replacement_product_names: replacementNames,
        };
      }));
      setFieldAgents(agentIds.map(id => ({ id, name: profMap.get(id) || "Agent" })));
    } catch (err: any) {
      toast.error("Failed to load inventory: " + (err?.message || "unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Build tracked articles — products with inventory rows, grouped by group_id for sets
  const trackedArticles = useMemo<TrackedArticle[]>(() => {
    const productMap = new Map(allProducts.map(p => [p.id, p]));
    const photoMap = new Map(photoRows.map(p => [p.product_id, p.photo_url]));

    // Group inv rows by product_id
    const byProduct = new Map<string, { rows: InvRow[]; group_id: string | null }>();
    invRows.forEach(r => {
      const entry = byProduct.get(r.product_id);
      if (!entry) byProduct.set(r.product_id, { rows: [r], group_id: r.group_id || null });
      else { entry.rows.push(r); if (!entry.group_id && r.group_id) entry.group_id = r.group_id; }
    });

    // Build individual article objects
    const articleMap = new Map<string, TrackedArticle>();
    byProduct.forEach(({ rows, group_id }, productId) => {
      const prod = productMap.get(productId);
      const locs: LocEntry[] = rows.map(r => {
        const loc = locations.find(l => l.id === r.location_id);
        return { location_id: r.location_id, name: loc?.name || "—", type: loc?.type || "warehouse", qty: r.quantity, updated_at: r.updated_at, updated_by: r.updated_by };
      });
      articleMap.set(productId, {
        group_id: group_id || undefined,
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

    // Bucket by group_id; singles go straight to output
    const groups = new Map<string, TrackedArticle[]>();
    const output: TrackedArticle[] = [];
    articleMap.forEach(article => {
      if (article.group_id) {
        if (!groups.has(article.group_id)) groups.set(article.group_id, []);
        groups.get(article.group_id)!.push(article);
      } else {
        output.push(article);
      }
    });

    // Combine each group into a single display entry
    groups.forEach(members => {
      if (members.length === 1) { output.push(members[0]); return; }
      const first = members[0];
      const combinedLoc = new Map<string, LocEntry>();
      members.forEach(m => m.locs.forEach(l => {
        const e = combinedLoc.get(l.location_id);
        if (!e) combinedLoc.set(l.location_id, { ...l });
        else {
          e.qty += l.qty;
          // keep the most recent updated_at + corresponding user
          if (l.updated_at && (!e.updated_at || l.updated_at > e.updated_at)) {
            e.updated_at = l.updated_at;
            e.updated_by = l.updated_by;
          }
        }
      }));
      const minTotal = Math.min(...members.map(m => Math.max(1, m.total)));
      output.push({
        group_id: first.group_id,
        product_id: first.product_id,
        product_name: members.map(m => m.product_name).join(" + "),
        sku: members.map(m => m.sku).join(", "),
        net_price: members.reduce((s, m) => s + m.net_price * (m.total / minTotal), 0),
        category_name: first.category_name,
        photo_url: first.photo_url,
        locs: [...combinedLoc.entries()].map(([location_id, v]) => ({ location_id, ...v })),
        total: Math.min(...members.map(m => m.total)),
        parts: members.map(m => ({
          product_id: m.product_id, product_name: m.product_name,
          sku: m.sku, net_price: m.net_price, locs: m.locs, total: m.total,
        })),
      });
    });

    return output.sort((a, b) => a.product_name.localeCompare(b.product_name));
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
          {(isAdmin || isSales || isAccounts || isServiceHead) && (
            <Button variant="outline" size="sm" onClick={() => setAddArticleOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />Add Article
            </Button>
          )}
          {(isAdmin || isSales) && (
            <Button variant="default" size="sm" onClick={() => setRequestProductOpen(true)}>
              <Truck className="w-4 h-4 mr-1" />Request from Warehouse
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
                      {/* Header: name + SKUs + price */}
                      <div>
                        {a.parts && (
                          <span className="inline-flex items-center text-[10px] font-medium bg-primary/10 text-primary rounded px-1.5 py-0.5 mb-1">
                            Set · {a.parts.length} items
                          </span>
                        )}
                        <h3 className="font-semibold text-sm leading-tight line-clamp-2">{a.product_name}</h3>
                        <p className="text-xs text-muted-foreground font-mono leading-snug">{a.sku}</p>
                        {a.category_name && <p className="text-xs text-muted-foreground">{a.category_name}</p>}
                      </div>

                      {/* Price — combined for sets (each part: qty × unit_price) */}
                      <div>
                        <span className="text-base font-bold text-primary">₹{a.net_price.toLocaleString("en-IN")}</span>
                        {a.parts && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                            {a.parts.map(p =>
                              p.total > 1
                                ? `${p.total} × ₹${p.net_price.toLocaleString("en-IN")}`
                                : `₹${p.net_price.toLocaleString("en-IN")}`
                            ).join(" + ")}
                          </p>
                        )}
                        {!a.parts && a.total > 1 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Total value: <span className="font-semibold text-foreground">₹{(a.net_price * a.total).toLocaleString("en-IN")}</span> ({a.total} × ₹{a.net_price.toLocaleString("en-IN")})
                          </p>
                        )}
                      </div>

                      {/* Stock display */}
                      {a.parts ? (
                        // Per-part breakdown for sets
                        <div className="space-y-1.5">
                          {a.parts.map(part => (
                            <div key={part.product_id} className="bg-muted/50 rounded p-2">
                              <p className="text-[10px] font-semibold mb-1 flex items-center justify-between">
                                <span className="truncate">{part.product_name}</span>
                                <span className="font-mono text-muted-foreground ml-1 shrink-0">{part.sku}</span>
                              </p>
                              {part.locs.map(l => (
                                <div key={l.location_id} className="flex justify-between text-xs">
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    {l.type === "warehouse" ? <Warehouse className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                                    {l.name}
                                  </span>
                                  <span className={`font-semibold ${l.qty === 0 ? "text-red-500" : ""}`}>{l.qty}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        // Single product stock
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
                      )}

                      {/* Receive stock button */}
                      {(isAdmin || isSales || isAccounts || isServiceHead) && (
                        <Button size="sm" variant="outline" className="w-full text-xs h-7"
                          onClick={() => setReceiveArticle(a)}>
                          <Plus className="w-3 h-3 mr-1" />Receive Stock
                        </Button>
                      )}

                      {/* Sale actions — per part for sets, single for individual */}
                      {!isFieldAgent && (
                        <div className="flex flex-col gap-1 mt-auto">
                          {a.parts ? (
                            // Set: sell buttons per part
                            a.parts.map(part => {
                              const partArticle: TrackedArticle = {
                                product_id: part.product_id, product_name: part.product_name,
                                sku: part.sku, net_price: part.net_price, locs: part.locs, total: part.total,
                                category_name: a.category_name, photo_url: a.photo_url,
                              };
                              return (
                                <div key={part.product_id} className="border rounded p-1.5 space-y-1">
                                  <p className="text-[10px] font-mono text-muted-foreground">{part.sku}</p>
                                  <div className="flex gap-1">
                                    <Button size="sm" className="flex-1 text-[10px] h-6 bg-blue-600 hover:bg-blue-700 px-1" onClick={() => { setSellArticle(partArticle); setSellMode("warehouse"); }}>
                                      <Warehouse className="w-3 h-3 mr-0.5" />WH
                                    </Button>
                                    <Button size="sm" className="flex-1 text-[10px] h-6 bg-emerald-600 hover:bg-emerald-700 px-1" onClick={() => { setSellArticle(partArticle); setSellMode("showroom"); }}>
                                      <Store className="w-3 h-3 mr-0.5" />SR
                                    </Button>
                                    <Button size="sm" variant="outline" className="flex-1 text-[10px] h-6 px-1" onClick={() => { setSellArticle(partArticle); setSellMode("company"); }}>
                                      <Truck className="w-3 h-3 mr-0.5" />Order
                                    </Button>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <>
                              <Button size="sm" className="w-full text-xs h-7 bg-blue-600 hover:bg-blue-700" onClick={() => { setSellArticle(a); setSellMode("warehouse"); }}>
                                <Warehouse className="w-3 h-3 mr-1" />Sold via Warehouse
                              </Button>
                              <Button size="sm" className="w-full text-xs h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setSellArticle(a); setSellMode("showroom"); }}>
                                <Store className="w-3 h-3 mr-1" />Sold via Showroom
                              </Button>
                              <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={() => { setSellArticle(a); setSellMode("company"); }}>
                                <Truck className="w-3 h-3 mr-1" />Order to Company
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {/* Admin: delete entire article from inventory */}
                      {isAdmin && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="w-full text-xs h-7 text-destructive border-destructive/30">
                              <Trash2 className="w-3 h-3 mr-1" />Remove from Inventory
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {a.product_name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Deletes all stock entries (across every location) for this article. The product remains in the price list and can be re-added anytime.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => {
                                  const { error } = await supabase.from("hde_inventory" as any).delete().eq("product_id", a.product_id);
                                  if (error) toast.error(error.message);
                                  else { toast.success("Removed from inventory"); loadAll(); }
                                }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>


          {/* ── Orders ── */}
          <TabsContent value="orders" className="mt-4">
            <OrdersView orders={orders} onSelect={o => { setSelectedOrder(o); setOrderDetailOpen(true); }} onRefresh={loadAll} isAdmin={isAdmin} userId={user.id} />
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
            <StockTable articles={trackedArticles} locations={locations} userId={user.id} isAdmin={isAdmin} userMap={userMap} onRefresh={loadAll} />
          </TabsContent>
        </Tabs>
      )}

      {/* Dialogs */}
      <AddArticleDialog open={addArticleOpen} onClose={() => setAddArticleOpen(false)} allProducts={allProducts} locations={locations} userId={user.id} onDone={loadAll} />
      <ReceiveStockDialog open={!!receiveArticle} onClose={() => setReceiveArticle(null)} article={receiveArticle} locations={locations} userId={user.id} onDone={loadAll} />
      <CreateOrderDialog open={!!sellMode} onClose={() => { setSellMode(null); setSellArticle(null); }} mode={sellMode} article={sellArticle} allProducts={allProducts} locations={locations} userId={user.id} onCreated={loadAll} />
      <OrderDetailDialog order={selectedOrder} open={orderDetailOpen} onClose={() => { setOrderDetailOpen(false); setSelectedOrder(null); }} userId={user.id} userRole={role} fieldAgents={fieldAgents} onUpdated={loadAll} />
      <RequestProductDialog open={requestProductOpen} onClose={() => setRequestProductOpen(false)} allProducts={allProducts} userId={user.id} onCreated={loadAll} />
    </div>
  );
}

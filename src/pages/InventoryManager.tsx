import { useEffect, useMemo, useState, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Package, Search, Filter, Warehouse, Store, ShoppingCart, ClipboardList,
  CheckCircle, XCircle, Clock, AlertTriangle, Camera, Upload, Eye,
  ChevronRight, Building2, Truck, BarChart3, MapPin, User, Calendar,
  Plus, Minus, Edit2, Trash2, RefreshCw, X, CheckSquare,
  TrendingUp, AlertCircle, Circle,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  sku: string;
  product_name: string;
  net_price: number;
  status: string;
  category_name?: string;
  brand_code?: string;
  line_code?: string;
  hsn_code?: string;
}

interface Location {
  id: string;
  name: string;
  type: "warehouse" | "showroom";
}

interface InventoryRow {
  id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  inventory_type: string;
}

interface HdeOrder {
  id: string;
  order_number: string;
  order_type: "warehouse" | "showroom" | "company";
  company_order_reason?: string;
  order_tag?: string;
  product_id: string;
  replacement_product_id?: string;
  location_id?: string;
  customer_name?: string;
  customer_phone?: string;
  status: string;
  notes?: string;
  custom_specs?: string;
  created_at: string;
  created_by: string;
  approved_at?: string;
  approved_by?: string;
  rejection_reason?: string;
  service_assigned_at?: string;
  field_assigned_at?: string;
  field_assigned_to?: string;
  due_date?: string;
  completed_at?: string;
  updated_at: string;
  product_name?: string;
  creator_name?: string;
  field_agent_name?: string;
  replacement_product_name?: string;
}

interface TimelineEntry {
  id: string;
  order_id: string;
  action: string;
  description?: string;
  old_value?: string;
  new_value?: string;
  performed_by?: string;
  performed_at: string;
  performer_name?: string;
}

interface JobPhoto {
  id: string;
  order_id: string;
  photo_type: "before" | "after" | "other";
  photo_url: string;
  uploaded_by?: string;
  uploaded_at: string;
}

interface Profile {
  id: string;
  name: string;
  role?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  service_assigned: "Service Assigned",
  field_assigned: "Field Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
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
  warehouse: "Sold via Warehouse",
  showroom: "Sold via Showroom",
  company: "Order to Company",
};

const REASON_LABELS: Record<string, string> = {
  no_stock: "No Stock Available",
  fresh_piece: "Fresh Piece Requested",
  custom: "Custom Requirement",
};

function agingColor(days: number) {
  if (days < 90) return "text-green-600";
  if (days < 180) return "text-amber-600";
  return "text-red-600";
}

function agingBg(days: number) {
  if (days < 90) return "bg-green-50 border-green-200";
  if (days < 180) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// ─── Inventory Catalogue View ─────────────────────────────────────────────────

function CatalogueView({
  products, inventory, locations, onSell,
}: {
  products: Product[];
  inventory: InventoryRow[];
  locations: Location[];
  onSell: (product: Product, mode: "warehouse" | "showroom" | "company") => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const invMap = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    inventory.forEach(r => {
      if (!m[r.product_id]) m[r.product_id] = {};
      m[r.product_id][r.location_id] = (m[r.product_id][r.location_id] || 0) + r.quantity;
    });
    return m;
  }, [inventory]);

  const warehouse = useMemo(() => locations.find(l => l.type === "warehouse"), [locations]);
  const showrooms = useMemo(() => locations.filter(l => l.type === "showroom"), [locations]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category_name).filter(Boolean))];
    return cats.sort() as string[];
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (search && !p.product_name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter !== "all" && p.category_name !== categoryFilter) return false;
      if (priceMin && p.net_price < parseFloat(priceMin)) return false;
      if (priceMax && p.net_price > parseFloat(priceMax)) return false;
      return true;
    });
  }, [products, search, categoryFilter, priceMin, priceMax]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search products, SKU…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Min price" type="number" className="w-28" value={priceMin} onChange={e => setPriceMin(e.target.value)} />
        <Input placeholder="Max price" type="number" className="w-28" value={priceMax} onChange={e => setPriceMax(e.target.value)} />
        {(search || categoryFilter !== "all" || priceMin || priceMax) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategoryFilter("all"); setPriceMin(""); setPriceMax(""); }}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} product{filtered.length !== 1 ? "s" : ""}</p>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No products found.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => {
            const pInv = invMap[p.id] || {};
            const warehouseQty = warehouse ? (pInv[warehouse.id] || 0) : 0;
            const showroomQtys = showrooms.map(s => ({ name: s.name, qty: pInv[s.id] || 0 }));
            return (
              <Card key={p.id} className="overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                <div className="w-full h-44 bg-muted flex items-center justify-center relative">
                  <Package className="w-14 h-14 text-muted-foreground opacity-30" />
                  <div className="absolute top-2 right-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <CardContent className="p-3 flex-1 flex flex-col gap-2">
                  <div>
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2">{p.product_name}</h3>
                    <p className="text-xs text-muted-foreground">{p.sku}</p>
                    {p.category_name && <p className="text-xs text-muted-foreground">{p.category_name}</p>}
                  </div>
                  <div className="text-lg font-bold text-primary">₹{p.net_price.toLocaleString("en-IN")}</div>

                  {/* Inventory levels */}
                  <div className="bg-muted/50 rounded-lg p-2 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1"><Warehouse className="w-3 h-3" /> Warehouse</span>
                      <span className="font-semibold">{warehouseQty}</span>
                    </div>
                    {showroomQtys.map(s => (
                      <div key={s.name} className="flex justify-between text-xs">
                        <span className="flex items-center gap-1"><Store className="w-3 h-3" /> {s.name}</span>
                        <span className="font-semibold">{s.qty}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1 mt-auto pt-1">
                    <Button size="sm" className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700" onClick={() => onSell(p, "warehouse")}>
                      <Warehouse className="w-3 h-3 mr-1" /> Sold via Warehouse
                    </Button>
                    <Button size="sm" className="w-full text-xs h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => onSell(p, "showroom")}>
                      <Store className="w-3 h-3 mr-1" /> Sold via Showroom
                    </Button>
                    <Button size="sm" variant="outline" className="w-full text-xs h-8" onClick={() => onSell(p, "company")}>
                      <Truck className="w-3 h-3 mr-1" /> Order to Company
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Create Order Dialog ──────────────────────────────────────────────────────

function CreateOrderDialog({
  open, onClose, mode, product, products, locations, userId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  mode: "warehouse" | "showroom" | "company" | null;
  product: Product | null;
  products: Product[];
  locations: Location[];
  userId: string;
  onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [customSpecs, setCustomSpecs] = useState("");
  const [companyReason, setCompanyReason] = useState("");
  const [replacementProductId, setReplacementProductId] = useState("");
  const [replacementSearch, setReplacementSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCustomerName(""); setCustomerPhone(""); setLocationId(""); setNotes("");
      setCustomSpecs(""); setCompanyReason(""); setReplacementProductId(""); setReplacementSearch("");
    }
  }, [open]);

  const filteredReplacement = useMemo(() => {
    if (!replacementSearch) return products.slice(0, 20);
    return products.filter(p =>
      p.product_name.toLowerCase().includes(replacementSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(replacementSearch.toLowerCase())
    ).slice(0, 20);
  }, [products, replacementSearch]);

  const warehouses = locations.filter(l => l.type === "warehouse");
  const showrooms = locations.filter(l => l.type === "showroom");

  const handleCreate = async () => {
    if (!product || !mode) return;
    if (mode === "company" && !companyReason) return toast.error("Please select a reason");
    if (mode === "showroom" && !replacementProductId) return toast.error("Please select a replacement product");
    if (!locationId) return toast.error("Please select a location");

    setSaving(true);
    const orderTag = mode === "company"
      ? (companyReason === "no_stock" ? "stock_out_order" : companyReason === "fresh_piece" ? "fresh_piece_order" : "custom_order")
      : undefined;

    const orderNum = await supabase.rpc("generate_hde_order_number" as any);

    const { data, error } = await supabase.from("hde_orders" as any).insert({
      order_number: orderNum.data || `HDE-${Date.now()}`,
      order_type: mode,
      company_order_reason: companyReason || null,
      order_tag: orderTag || null,
      product_id: product.id,
      replacement_product_id: replacementProductId || null,
      location_id: locationId,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      status: "pending_approval",
      notes: notes || null,
      custom_specs: customSpecs || null,
      created_by: userId,
    }).select().single();

    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message || "Failed to create order");
    }

    const orderId = (data as any).id;

    // Log timeline
    await supabase.from("hde_order_timeline" as any).insert({
      order_id: orderId,
      action: "Order Created",
      description: `${ORDER_TYPE_LABELS[mode]} order created for ${product.product_name}`,
      performed_by: userId,
    });

    // If showroom sale, create/update display item
    if (mode === "showroom") {
      await supabase.from("hde_display_items" as any).insert({
        product_id: product.id,
        location_id: locationId,
        display_status: "sold",
        replacement_product_id: replacementProductId,
        order_id: orderId,
        updated_by: userId,
      });
    }

    setSaving(false);
    toast.success("Order created successfully");
    onCreated();
    onClose();
  };

  if (!product || !mode) return null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {mode === "warehouse" && <span className="flex items-center gap-2"><Warehouse className="w-4 h-4 text-blue-600" /> Sold via Warehouse</span>}
            {mode === "showroom" && <span className="flex items-center gap-2"><Store className="w-4 h-4 text-emerald-600" /> Sold via Showroom</span>}
            {mode === "company" && <span className="flex items-center gap-2"><Truck className="w-4 h-4" /> Order to Company</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-semibold">{product.product_name}</p>
            <p className="text-xs text-muted-foreground">{product.sku} · ₹{product.net_price.toLocaleString("en-IN")}</p>
          </div>

          {/* Company order reason */}
          {mode === "company" && (
            <div>
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Select value={companyReason} onValueChange={setCompanyReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_stock">No Stock Available</SelectItem>
                  <SelectItem value="fresh_piece">Fresh Piece Requested by Customer</SelectItem>
                  <SelectItem value="custom">Custom Requirement</SelectItem>
                </SelectContent>
              </Select>
              {companyReason === "custom" && (
                <div className="mt-2">
                  <Label>Custom Specifications</Label>
                  <Textarea value={customSpecs} onChange={e => setCustomSpecs(e.target.value)} placeholder="Describe custom fabric, colour, size or specs…" rows={3} />
                </div>
              )}
            </div>
          )}

          {/* Location */}
          <div>
            <Label>Location <span className="text-destructive">*</span></Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {(mode === "warehouse" ? warehouses : showrooms).map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Replacement product for showroom */}
          {mode === "showroom" && (
            <div>
              <Label>Replacement Product <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Search replacement product…"
                value={replacementSearch}
                onChange={e => setReplacementSearch(e.target.value)}
                className="mb-2"
              />
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {filteredReplacement.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setReplacementProductId(p.id); setReplacementSearch(p.product_name); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0 ${replacementProductId === p.id ? "bg-blue-50" : ""}`}
                  >
                    <span className="font-medium">{p.product_name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{p.sku} · ₹{p.net_price.toLocaleString("en-IN")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Customer info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Customer Name</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label>Customer Phone</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes…" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Order Detail / Timeline Dialog ──────────────────────────────────────────

function OrderDetailDialog({
  order, open, onClose, userId, userRole, fieldAgents, products, onUpdated,
}: {
  order: HdeOrder | null;
  open: boolean;
  onClose: () => void;
  userId: string;
  userRole: string;
  fieldAgents: Profile[];
  products: Product[];
  onUpdated: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoType, setPhotoType] = useState<"before" | "after" | "other">("before");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && order) {
      setLoading(true);
      Promise.all([
        supabase.from("hde_order_timeline" as any).select("*, profiles(name)").eq("order_id", order.id).order("performed_at", { ascending: true }),
        supabase.from("hde_job_photos" as any).select("*").eq("order_id", order.id).order("uploaded_at", { ascending: true }),
      ]).then(([t, p]) => {
        setTimeline(((t.data as any) || []).map((r: any) => ({ ...r, performer_name: r.profiles?.name })));
        setPhotos((p.data as any) || []);
        setLoading(false);
      });
    }
  }, [open, order]);

  const logTimeline = async (action: string, desc: string, oldV?: string, newV?: string) => {
    await supabase.from("hde_order_timeline" as any).insert({
      order_id: order!.id,
      action,
      description: desc,
      old_value: oldV || null,
      new_value: newV || null,
      performed_by: userId,
    });
  };

  const handleApprove = async () => {
    setSaving(true);
    await supabase.from("hde_orders" as any).update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
    }).eq("id", order!.id);
    await logTimeline("Approved by Accounts", actionNote || "Order approved", "pending_approval", "approved");
    setSaving(false);
    toast.success("Order approved");
    onUpdated();
    onClose();
  };

  const handleReject = async () => {
    if (!actionNote) return toast.error("Please provide a rejection reason");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_by: userId,
      rejection_reason: actionNote,
    }).eq("id", order!.id);
    await logTimeline("Rejected by Accounts", actionNote, "pending_approval", "rejected");
    setSaving(false);
    toast.success("Order rejected");
    onUpdated();
    onClose();
  };

  const handleAssignField = async () => {
    if (!selectedAgent) return toast.error("Please select a field agent");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({
      status: "field_assigned",
      field_assigned_to: selectedAgent,
      field_assigned_at: new Date().toISOString(),
      service_assigned_at: new Date().toISOString(),
      service_assigned_by: userId,
      due_date: dueDate || null,
    }).eq("id", order!.id);
    const agent = fieldAgents.find(a => a.id === selectedAgent);
    await logTimeline("Field Agent Assigned", `Assigned to ${agent?.name || "agent"}. ${actionNote || ""}`.trim(), order!.status, "field_assigned");
    setSaving(false);
    toast.success("Field agent assigned");
    onUpdated();
    onClose();
  };

  const handleMarkComplete = async () => {
    if (photos.length === 0) return toast.error("Please upload at least one photo before completing");
    setSaving(true);
    await supabase.from("hde_orders" as any).update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: userId,
    }).eq("id", order!.id);
    // If showroom order, update display item
    if (order!.order_type === "showroom") {
      await supabase.from("hde_display_items" as any).update({
        display_status: "installed",
        updated_by: userId,
      }).eq("order_id", order!.id);
    }
    await logTimeline("Job Completed", actionNote || "Work marked as complete", order!.status, "completed");
    setSaving(false);
    toast.success("Order completed");
    onUpdated();
    onClose();
  };

  const handleUploadPhoto = async () => {
    if (!photoUrl.trim()) return toast.error("Enter photo URL");
    setSaving(true);
    await supabase.from("hde_job_photos" as any).insert({
      order_id: order!.id,
      photo_type: photoType,
      photo_url: photoUrl.trim(),
      uploaded_by: userId,
    });
    await logTimeline("Photo Uploaded", `${photoType} photo uploaded`);
    setPhotoUrl("");
    const { data } = await supabase.from("hde_job_photos" as any).select("*").eq("order_id", order!.id).order("uploaded_at", { ascending: true });
    setPhotos((data as any) || []);
    setSaving(false);
    toast.success("Photo uploaded");
  };

  if (!order) return null;

  const canApprove = userRole === "accounts" || userRole === "admin";
  const canAssign = userRole === "service_head" || userRole === "admin";
  const canComplete = userRole === "field_agent" || userRole === "admin";
  const isFieldAgent = userRole === "field_agent" && order.field_assigned_to === userId;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4" />
            {order.order_number}
            <StatusBadge status={order.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Order info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/40 rounded-lg p-3 space-y-1">
              <p className="font-semibold">{order.product_name || "—"}</p>
              <p className="text-muted-foreground">{ORDER_TYPE_LABELS[order.order_type]}</p>
              {order.order_tag && <Badge variant="outline" className="text-xs">{order.order_tag.replace(/_/g, " ")}</Badge>}
              {order.company_order_reason && <p className="text-xs text-muted-foreground">{REASON_LABELS[order.company_order_reason]}</p>}
            </div>
            <div className="bg-muted/40 rounded-lg p-3 space-y-1">
              {order.customer_name && <p><span className="font-medium">Customer:</span> {order.customer_name}</p>}
              {order.customer_phone && <p><span className="font-medium">Phone:</span> {order.customer_phone}</p>}
              <p className="text-xs text-muted-foreground">Created: {new Date(order.created_at).toLocaleDateString("en-IN")}</p>
              {order.due_date && <p className="text-xs"><span className="font-medium">Due:</span> {new Date(order.due_date).toLocaleDateString("en-IN")}</p>}
            </div>
          </div>
          {order.notes && <div className="text-sm bg-muted/30 rounded p-2"><span className="font-medium">Notes:</span> {order.notes}</div>}
          {order.custom_specs && <div className="text-sm bg-muted/30 rounded p-2"><span className="font-medium">Custom Specs:</span> {order.custom_specs}</div>}
          {order.replacement_product_name && <div className="text-sm bg-blue-50 rounded p-2"><span className="font-medium">Replacement:</span> {order.replacement_product_name}</div>}

          {/* Timeline */}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Clock className="w-4 h-4" /> Timeline</h4>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No timeline entries.</p>
            ) : (
              <div className="relative pl-4">
                {timeline.map((t, i) => (
                  <div key={t.id} className="relative pb-3">
                    <div className="absolute -left-2 top-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Circle className="w-2 h-2 text-primary-foreground fill-current" />
                    </div>
                    {i < timeline.length - 1 && <div className="absolute -left-0.5 top-4 bottom-0 w-px bg-border" />}
                    <div className="ml-4">
                      <p className="text-sm font-medium">{t.action}</p>
                      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                      <p className="text-xs text-muted-foreground">
                        {t.performer_name} · {new Date(t.performed_at).toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photos */}
          {photos.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><Camera className="w-4 h-4" /> Photos</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map(ph => (
                  <div key={ph.id} className="relative">
                    <img src={ph.photo_url} alt={ph.photo_type} className="w-full h-24 object-cover rounded border" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1 rounded">{ph.photo_type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photo upload (field agent / admin) */}
          {(canComplete || canAssign) && order.status !== "completed" && order.status !== "rejected" && order.status !== "cancelled" && (
            <div className="border rounded-lg p-3 space-y-2">
              <h4 className="text-sm font-semibold">Upload Photo</h4>
              <div className="flex gap-2">
                <Select value={photoType} onValueChange={v => setPhotoType(v as any)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">Before</SelectItem>
                    <SelectItem value="after">After</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Photo URL…" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={handleUploadPhoto} disabled={saving}>Upload</Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border rounded-lg p-3 space-y-3">
            <h4 className="text-sm font-semibold">Actions</h4>
            <Textarea placeholder="Note / comment (optional for approval, required for rejection)…" value={actionNote} onChange={e => setActionNote(e.target.value)} rows={2} />

            {canApprove && order.status === "pending_approval" && (
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleApprove} disabled={saving}>
                  <CheckCircle className="w-4 h-4 mr-1" /> Approve
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={saving}>
                  <XCircle className="w-4 h-4 mr-1" /> Reject
                </Button>
              </div>
            )}

            {canAssign && (order.status === "approved" || order.status === "service_assigned") && (
              <div className="space-y-2">
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger><SelectValue placeholder="Select field agent…" /></SelectTrigger>
                  <SelectContent>
                    {fieldAgents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="flex-1" placeholder="Due date" />
                  <Button onClick={handleAssignField} disabled={saving}>
                    <User className="w-4 h-4 mr-1" /> Assign
                  </Button>
                </div>
              </div>
            )}

            {canComplete && order.status === "field_assigned" && (
              <Button className="w-full bg-green-600 hover:bg-green-700" onClick={handleMarkComplete} disabled={saving}>
                <CheckSquare className="w-4 h-4 mr-1" /> Mark Complete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Orders View ──────────────────────────────────────────────────────────────

function OrdersView({
  orders, userId, userRole, fieldAgents, products, onSelect, onRefresh,
}: {
  orders: HdeOrder[];
  userId: string;
  userRole: string;
  fieldAgents: Profile[];
  products: Product[];
  onSelect: (order: HdeOrder) => void;
  onRefresh: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (typeFilter !== "all" && o.order_type !== typeFilter) return false;
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase()) &&
        !(o.product_name || "").toLowerCase().includes(search.toLowerCase()) &&
        !(o.customer_name || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [orders, statusFilter, typeFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search orders…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="warehouse">Sold via Warehouse</SelectItem>
            <SelectItem value="showroom">Sold via Showroom</SelectItem>
            <SelectItem value="company">Order to Company</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={onRefresh}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      <div className="text-sm text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No orders found.</p>
          </Card>
        ) : (
          filtered.map(o => {
            const days = daysSince(o.created_at);
            const isOpen = !["completed", "cancelled", "rejected"].includes(o.status);
            return (
              <Card
                key={o.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow border ${isOpen ? agingBg(days) : ""}`}
                onClick={() => onSelect(o)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">{o.order_number}</span>
                      <StatusBadge status={o.status} />
                      <span className="text-xs px-2 py-0.5 rounded bg-muted border text-muted-foreground">
                        {ORDER_TYPE_LABELS[o.order_type]}
                      </span>
                      {o.order_tag && <span className="text-xs px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-orange-700">{o.order_tag.replace(/_/g, " ")}</span>}
                    </div>
                    <p className="text-sm mt-1 font-medium truncate">{o.product_name}</p>
                    {o.customer_name && <p className="text-xs text-muted-foreground">Customer: {o.customer_name}</p>}
                    {o.creator_name && <p className="text-xs text-muted-foreground">By: {o.creator_name}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("en-IN")}</p>
                    {isOpen && (
                      <p className={`text-xs font-medium mt-1 ${agingColor(days)}`}>{days}d open</p>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 ml-auto" />
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Field Jobs View ──────────────────────────────────────────────────────────

function FieldJobsView({
  orders, userId, onSelect,
}: {
  orders: HdeOrder[];
  userId: string;
  onSelect: (order: HdeOrder) => void;
}) {
  const myJobs = useMemo(() =>
    orders.filter(o => o.field_assigned_to === userId && o.status !== "completed" && o.status !== "cancelled"),
    [orders, userId]
  );

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">{myJobs.length} assigned job{myJobs.length !== 1 ? "s" : ""}</div>
      {myJobs.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <CheckSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>No jobs assigned to you.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {myJobs.map(o => {
            const days = daysSince(o.created_at);
            return (
              <Card key={o.id} className={`p-4 cursor-pointer hover:shadow-md transition-shadow border ${agingBg(days)}`} onClick={() => onSelect(o)}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">{o.order_number}</p>
                    <p className="text-sm font-medium mt-1">{o.product_name}</p>
                    {o.customer_name && <p className="text-xs text-muted-foreground"><User className="inline w-3 h-3 mr-1" />{o.customer_name}</p>}
                    {o.due_date && <p className="text-xs text-muted-foreground"><Calendar className="inline w-3 h-3 mr-1" />Due: {new Date(o.due_date).toLocaleDateString("en-IN")}</p>}
                  </div>
                  <div className="text-right">
                    <StatusBadge status={o.status} />
                    <p className={`text-xs font-medium mt-2 ${agingColor(days)}`}>{days}d</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t">
                  <Button size="sm" className="w-full" onClick={e => { e.stopPropagation(); onSelect(o); }}>
                    <Eye className="w-3 h-3 mr-1" /> View & Update
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Management Dashboard ─────────────────────────────────────────────────────

function DashboardView({ orders }: { orders: HdeOrder[] }) {
  const stats = useMemo(() => {
    const pending = orders.filter(o => o.status === "pending_approval").length;
    const approved = orders.filter(o => o.status === "approved").length;
    const serviceAssigned = orders.filter(o => o.status === "service_assigned").length;
    const fieldAssigned = orders.filter(o => o.status === "field_assigned").length;
    const inProgress = orders.filter(o => o.status === "in_progress").length;
    const completed = orders.filter(o => o.status === "completed").length;
    const rejected = orders.filter(o => o.status === "rejected").length;
    const warehouse = orders.filter(o => o.order_type === "warehouse").length;
    const showroom = orders.filter(o => o.order_type === "showroom").length;
    const company = orders.filter(o => o.order_type === "company").length;
    const stockOut = orders.filter(o => o.order_tag === "stock_out_order").length;
    const freshPiece = orders.filter(o => o.order_tag === "fresh_piece_order").length;
    const custom = orders.filter(o => o.order_tag === "custom_order").length;
    const alert90 = orders.filter(o => !["completed","cancelled","rejected"].includes(o.status) && daysSince(o.created_at) >= 90 && daysSince(o.created_at) < 180).length;
    const alert180 = orders.filter(o => !["completed","cancelled","rejected"].includes(o.status) && daysSince(o.created_at) >= 180).length;

    return { pending, approved, serviceAssigned, fieldAssigned, inProgress, completed, rejected, warehouse, showroom, company, stockOut, freshPiece, custom, alert90, alert180 };
  }, [orders]);

  const statCards = [
    { label: "Pending Approval", value: stats.pending, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "Approved", value: stats.approved, icon: CheckCircle, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Field Assigned", value: stats.fieldAssigned, icon: User, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Completed", value: stats.completed, icon: CheckSquare, color: "text-green-600", bg: "bg-green-50" },
    { label: "Via Warehouse", value: stats.warehouse, icon: Warehouse, color: "text-cyan-600", bg: "bg-cyan-50" },
    { label: "Via Showroom", value: stats.showroom, icon: Store, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Company Orders", value: stats.company, icon: Truck, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Stock Out Orders", value: stats.stockOut, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    { label: "Fresh Piece Orders", value: stats.freshPiece, icon: Package, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Custom Orders", value: stats.custom, icon: Edit2, color: "text-pink-600", bg: "bg-pink-50" },
    { label: "90-Day Alerts", value: stats.alert90, icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "180-Day Alerts", value: stats.alert180, icon: AlertTriangle, color: "text-red-700", bg: "bg-red-100" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {statCards.map(s => (
          <Card key={s.label} className={`p-4 ${s.bg}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon className={`w-6 h-6 ${s.color} opacity-60`} />
            </div>
          </Card>
        ))}
      </div>

      {/* Aging breakdown */}
      <Card className="p-4">
        <CardTitle className="text-sm mb-3">Open Orders by Age</CardTitle>
        <div className="space-y-2">
          {["pending_approval","approved","service_assigned","field_assigned","in_progress"].map(status => {
            const group = orders.filter(o => o.status === status);
            const green = group.filter(o => daysSince(o.created_at) < 90).length;
            const amber = group.filter(o => daysSince(o.created_at) >= 90 && daysSince(o.created_at) < 180).length;
            const red = group.filter(o => daysSince(o.created_at) >= 180).length;
            if (group.length === 0) return null;
            return (
              <div key={status} className="flex items-center gap-3 text-sm">
                <span className="w-36 text-muted-foreground truncate">{STATUS_LABELS[status]}</span>
                <span className="text-green-600 font-medium w-8">{green}</span>
                <span className="text-amber-600 font-medium w-8">{amber}</span>
                <span className="text-red-600 font-medium w-8">{red}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t">
            <span className="w-36" />
            <span className="w-8 text-green-600">0-89d</span>
            <span className="w-8 text-amber-600">90-179d</span>
            <span className="w-8 text-red-600">180+d</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Inventory Management (Admin) ─────────────────────────────────────────────

function InventoryManagementView({
  products, inventory, locations, userId, onRefresh,
}: {
  products: Product[];
  inventory: InventoryRow[];
  locations: Location[];
  userId: string;
  onRefresh: () => void;
}) {
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(0);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const invMap = useMemo(() => {
    const m: Record<string, Record<string, InventoryRow>> = {};
    inventory.forEach(r => {
      if (!m[r.product_id]) m[r.product_id] = {};
      m[r.product_id][r.location_id] = r;
    });
    return m;
  }, [inventory]);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p => p.product_name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, search]);

  const startEdit = (productId: string, locationId: string, currentQty: number) => {
    setEditProduct(productId); setEditLocation(locationId); setEditQty(currentQty);
  };

  const saveQty = async () => {
    if (!editProduct || !editLocation) return;
    setSaving(true);
    const existing = invMap[editProduct]?.[editLocation];
    const locType = locations.find(l => l.id === editLocation)?.type;
    if (existing) {
      await supabase.from("hde_inventory" as any).update({ quantity: editQty, updated_by: userId }).eq("id", existing.id);
    } else {
      await supabase.from("hde_inventory" as any).insert({
        product_id: editProduct, location_id: editLocation, quantity: editQty,
        inventory_type: locType === "warehouse" ? "warehouse" : "display",
        updated_by: userId,
      });
    }
    setSaving(false);
    setEditProduct(null); setEditLocation(null);
    onRefresh();
    toast.success("Quantity updated");
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              {locations.map(l => <TableHead key={l.id}>{l.name}</TableHead>)}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-sm">{p.product_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{p.sku}</TableCell>
                {locations.map(l => {
                  const row = invMap[p.id]?.[l.id];
                  const qty = row?.quantity ?? 0;
                  const isEditing = editProduct === p.id && editLocation === l.id;
                  return (
                    <TableCell key={l.id}>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Input type="number" min={0} value={editQty} onChange={e => setEditQty(parseInt(e.target.value) || 0)} className="h-7 w-16 text-center" />
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveQty} disabled={saving}><CheckCircle className="w-3 h-3 text-green-600" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditProduct(null); setEditLocation(null); }}><X className="w-3 h-3" /></Button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(p.id, l.id, qty)} className="flex items-center gap-1 hover:text-primary">
                          <span className={`font-semibold ${qty === 0 ? "text-red-500" : ""}`}>{qty}</span>
                          <Edit2 className="w-3 h-3 opacity-40" />
                        </button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Reports View ─────────────────────────────────────────────────────────────

function ReportsView({ orders }: { orders: HdeOrder[] }) {
  const agingReport = useMemo(() => {
    const open = orders.filter(o => !["completed","cancelled","rejected"].includes(o.status));
    return open.sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at));
  }, [orders]);

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <CardTitle className="text-sm mb-3">Aging Report — Open Orders</CardTitle>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Days Open</TableHead>
                <TableHead>Customer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingReport.map(o => {
                const d = daysSince(o.created_at);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.product_name}</TableCell>
                    <TableCell className="text-xs">{ORDER_TYPE_LABELS[o.order_type]}</TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className={`font-semibold ${agingColor(d)}`}>{d}</TableCell>
                    <TableCell className="text-xs">{o.customer_name || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4">
        <CardTitle className="text-sm mb-3">Order Type Summary</CardTitle>
        {(["warehouse","showroom","company"] as const).map(type => {
          const group = orders.filter(o => o.order_type === type);
          const done = group.filter(o => o.status === "completed").length;
          return (
            <div key={type} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
              <span>{ORDER_TYPE_LABELS[type]}</span>
              <span className="text-muted-foreground">{done}/{group.length} completed</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const InventoryManager = () => {
  const { user } = useAuth();
  if (!user) return null;

  const role = user.role as string;
  if (!["admin","sales","service_head","accounts","field_agent","site_agent"].includes(role)) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = role === "admin";
  const isSales = role === "sales" || role === "site_agent";
  const isAccounts = role === "accounts";
  const isServiceHead = role === "service_head";
  const isFieldAgent = role === "field_agent";

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [orders, setOrders] = useState<HdeOrder[]>([]);
  const [fieldAgents, setFieldAgents] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [sellMode, setSellMode] = useState<"warehouse" | "showroom" | "company" | null>(null);
  const [sellProduct, setSellProduct] = useState<Product | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<HdeOrder | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);

  const defaultTab = isFieldAgent ? "jobs" : isSales ? "catalogue" : isAccounts ? "orders" : "catalogue";

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [prod, locs, inv, ord, agents] = await Promise.all([
      supabase.from("products" as any).select("id, sku, product_name, net_price, status, brand_code, line_code, hsn_code, categories(name)").eq("status", "active").is("deleted_at", null).order("product_name"),
      supabase.from("hde_locations" as any).select("*").eq("is_active", true).order("name"),
      supabase.from("hde_inventory" as any).select("*"),
      supabase.from("hde_orders" as any).select("*, products(product_name), profiles!hde_orders_created_by_fkey(name), replacement:products!hde_orders_replacement_product_id_fkey(product_name), field_agent:profiles!hde_orders_field_assigned_to_fkey(name)").order("created_at", { ascending: false }),
      supabase.from("profiles" as any).select("id, name, user_roles!inner(role)").eq("user_roles.role", "field_agent"),
    ]);

    setProducts(((prod.data as any) || []).map((p: any) => ({ ...p, category_name: p.categories?.name })));
    setLocations((locs.data as any) || []);
    setInventory((inv.data as any) || []);
    setOrders(((ord.data as any) || []).map((o: any) => ({
      ...o,
      product_name: o.products?.product_name,
      creator_name: o.profiles?.name,
      field_agent_name: o.field_agent?.name,
      replacement_product_name: o.replacement?.product_name,
    })));
    setFieldAgents((agents.data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSell = (product: Product, mode: "warehouse" | "showroom" | "company") => {
    setSellProduct(product);
    setSellMode(mode);
  };

  const openOrderDetail = (order: HdeOrder) => {
    setSelectedOrder(order);
    setOrderDetailOpen(true);
  };

  const pendingApprovalCount = orders.filter(o => o.status === "pending_approval").length;
  const myJobsCount = orders.filter(o => o.field_assigned_to === user.id && !["completed","cancelled"].includes(o.status)).length;

  const tabItems = [
    { value: "catalogue", label: "Catalogue", show: !isFieldAgent },
    { value: "orders", label: `Orders${pendingApprovalCount > 0 && (isAccounts || isAdmin) ? ` (${pendingApprovalCount})` : ""}`, show: !isFieldAgent },
    { value: "jobs", label: `My Jobs${myJobsCount > 0 ? ` (${myJobsCount})` : ""}`, show: isFieldAgent || isAdmin },
    { value: "dashboard", label: "Dashboard", show: isAdmin || isServiceHead || isAccounts },
    { value: "inventory", label: "Stock Levels", show: isAdmin || isAccounts || isServiceHead },
    { value: "reports", label: "Reports", show: isAdmin },
  ].filter(t => t.show);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> Inventory & Fulfillment
          </h1>
          <p className="text-sm text-muted-foreground">Display inventory, catalogue and sales fulfillment management</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-primary mr-2" />
          <span className="text-muted-foreground">Loading…</span>
        </div>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            {tabItems.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {/* Catalogue */}
          <TabsContent value="catalogue" className="mt-4">
            <CatalogueView
              products={products}
              inventory={inventory}
              locations={locations}
              onSell={handleSell}
            />
          </TabsContent>

          {/* Orders */}
          <TabsContent value="orders" className="mt-4">
            <OrdersView
              orders={orders}
              userId={user.id}
              userRole={role}
              fieldAgents={fieldAgents}
              products={products}
              onSelect={openOrderDetail}
              onRefresh={loadAll}
            />
          </TabsContent>

          {/* Field Jobs */}
          <TabsContent value="jobs" className="mt-4">
            <FieldJobsView
              orders={orders}
              userId={user.id}
              onSelect={openOrderDetail}
            />
          </TabsContent>

          {/* Dashboard */}
          <TabsContent value="dashboard" className="mt-4">
            <DashboardView orders={orders} />
          </TabsContent>

          {/* Inventory Management */}
          <TabsContent value="inventory" className="mt-4">
            <InventoryManagementView
              products={products}
              inventory={inventory}
              locations={locations}
              userId={user.id}
              onRefresh={loadAll}
            />
          </TabsContent>

          {/* Reports */}
          <TabsContent value="reports" className="mt-4">
            <ReportsView orders={orders} />
          </TabsContent>
        </Tabs>
      )}

      {/* Create Order Dialog */}
      <CreateOrderDialog
        open={!!sellMode}
        onClose={() => { setSellMode(null); setSellProduct(null); }}
        mode={sellMode}
        product={sellProduct}
        products={products}
        locations={locations}
        userId={user.id}
        onCreated={loadAll}
      />

      {/* Order Detail Dialog */}
      <OrderDetailDialog
        order={selectedOrder}
        open={orderDetailOpen}
        onClose={() => { setOrderDetailOpen(false); setSelectedOrder(null); }}
        userId={user.id}
        userRole={role}
        fieldAgents={fieldAgents}
        products={products}
        onUpdated={loadAll}
      />
    </div>
  );
};

export default InventoryManager;

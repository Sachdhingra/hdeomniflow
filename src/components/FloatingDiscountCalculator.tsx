import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Calculator, X, Minus, Search, Package, GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Product {
  id: string;
  sku: string;
  product_name: string;
  category_id: string | null;
  net_price: number;
}

interface Category {
  id: string;
  name: string;
}

const GST_RATES = [0, 5, 12, 18, 28];

const formatINR = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: n % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

const FloatingDiscountCalculator = () => {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<"calc" | "products">("calc");

  // Calculator inputs
  const [mrp, setMrp] = useState("");
  const [discount, setDiscount] = useState("");
  const [qty, setQty] = useState("1");
  const [gstRate, setGstRate] = useState("18");

  // Products tab state
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingProds, setLoadingProds] = useState(false);
  const [prodSearch, setProdSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const prodsFetched = useRef(false);

  // Drag state
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 });
  const [pos, setPos] = useState({ right: 24, bottom: 84 });

  // Fetch products once when the products tab is first opened
  useEffect(() => {
    if (activeTab !== "products" || prodsFetched.current) return;
    prodsFetched.current = true;
    setLoadingProds(true);
    (async () => {
      const [prodRes, catRes] = await Promise.all([
        (supabase as any)
          .from("products")
          .select("id,sku,product_name,category_id,net_price")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("product_name")
          .limit(500),
        (supabase as any)
          .from("categories")
          .select("id,name")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name"),
      ]);
      setProducts((prodRes.data ?? []) as Product[]);
      setCategories((catRes.data ?? []) as Category[]);
      setLoadingProds(false);
    })();
  }, [activeTab]);

  // Calculator math
  const mrpNum = parseFloat(mrp) || 0;
  const discountPct = Math.min(Math.max(parseFloat(discount) || 0, 0), 100);
  const qtyNum = Math.max(parseInt(qty) || 1, 1);
  const gstPct = parseInt(gstRate) || 0;
  const discountAmt = mrpNum * (discountPct / 100);
  const afterDiscount = mrpNum - discountAmt;
  const gstAmt = afterDiscount * (gstPct / 100);
  const unitFinal = afterDiscount + gstAmt;
  const totalFinal = unitFinal * qtyNum;
  const totalSavings = discountAmt * qtyNum;

  // Filtered products
  const searchLower = prodSearch.toLowerCase().trim();
  const filteredProds = useMemo(
    () =>
      products
        .filter((p) => {
          if (catFilter !== "all" && p.category_id !== catFilter) return false;
          if (!searchLower) return true;
          return (
            p.product_name.toLowerCase().includes(searchLower) ||
            p.sku.toLowerCase().includes(searchLower)
          );
        })
        .slice(0, 120),
    [products, searchLower, catFilter]
  );

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initLeft: rect.left,
      initTop: rect.top,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active || !panelRef.current) return;
      const dx = e.clientX - drag.current.startX;
      const dy = e.clientY - drag.current.startY;
      const newLeft = drag.current.initLeft + dx;
      const newTop = drag.current.initTop + dy;
      const w = panelRef.current.offsetWidth;
      const h = panelRef.current.offsetHeight;
      const clampedLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
      const clampedTop = Math.max(0, Math.min(newTop, window.innerHeight - h));
      setPos({
        right: window.innerWidth - clampedLeft - w,
        bottom: window.innerHeight - clampedTop - h,
      });
    };
    const onUp = () => { drag.current.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleProductUse = (p: Product) => {
    setMrp(String(p.net_price));
    setActiveTab("calc");
  };

  const handleClear = () => {
    setMrp("");
    setDiscount("");
    setQty("1");
    setGstRate("18");
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Discount Calculator"
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full gradient-primary shadow-lg flex items-center justify-center text-primary-foreground hover:opacity-90 active:scale-95 transition-all"
        >
          <Calculator className="w-5 h-5" />
        </button>
      )}

      {/* Floating panel */}
      {open && (
        <div
          ref={panelRef}
          style={{ right: pos.right, bottom: pos.bottom, position: "fixed", zIndex: 999 }}
          className="w-[340px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Draggable header */}
          <div
            onMouseDown={onDragStart}
            className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-primary/10 to-primary/5 border-b border-border cursor-grab active:cursor-grabbing select-none"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
            <Calculator className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold flex-1 truncate">Discount Calculator</span>
            <button
              onClick={() => setMinimized((m) => !m)}
              title={minimized ? "Expand" : "Minimise"}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              title="Close"
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!minimized && (
            <>
              {/* Tabs */}
              <div className="flex border-b border-border shrink-0">
                {(["calc", "products"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${
                      activeTab === tab
                        ? "text-primary border-b-2 border-primary bg-primary/5"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "calc" ? "Calculator" : "Products"}
                  </button>
                ))}
              </div>

              {/* ── Calculator tab ── */}
              {activeTab === "calc" && (
                <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: 440 }}>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground font-medium">Base Price (₹)</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Enter price"
                      value={mrp}
                      onChange={(e) => setMrp(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground font-medium">Discount %</label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="0"
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground font-medium">Quantity</label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="1"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground font-medium">GST Rate</label>
                    <Select value={gstRate} onValueChange={setGstRate}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Result breakdown */}
                  {mrpNum > 0 && (
                    <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Base Price</span>
                        <span className="font-medium">{formatINR(mrpNum)}</span>
                      </div>
                      {discountPct > 0 && (
                        <div className="flex justify-between text-green-600 dark:text-green-400">
                          <span>Discount ({discountPct}%)</span>
                          <span>− {formatINR(discountAmt)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">After Discount</span>
                        <span className="font-medium">{formatINR(afterDiscount)}</span>
                      </div>
                      {gstPct > 0 && (
                        <div className="flex justify-between text-blue-600 dark:text-blue-400">
                          <span>GST ({gstPct}%)</span>
                          <span>+ {formatINR(gstAmt)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-2">
                        <span className="font-semibold">Unit Price</span>
                        <span className="font-bold text-primary">{formatINR(unitFinal)}</span>
                      </div>
                      {qtyNum > 1 && (
                        <div className="flex justify-between border-t border-border pt-2">
                          <span className="font-semibold">Total × {qtyNum}</span>
                          <span className="font-bold text-primary">{formatINR(totalFinal)}</span>
                        </div>
                      )}
                      {discountPct > 0 && (
                        <div className="flex justify-between text-green-600 dark:text-green-400 text-[10px]">
                          <span>You save</span>
                          <span>{formatINR(totalSavings)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleClear}
                    className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* ── Products tab ── */}
              {activeTab === "products" && (
                <div className="flex flex-col" style={{ height: 440 }}>
                  {/* Filters */}
                  <div className="p-2 space-y-2 border-b border-border shrink-0">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search name or SKU…"
                        value={prodSearch}
                        onChange={(e) => setProdSearch(e.target.value)}
                        className="h-7 pl-8 text-xs"
                      />
                    </div>
                    <Select value={catFilter} onValueChange={setCatFilter}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Scrollable list */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                    {loadingProds ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))
                    ) : filteredProds.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                        <Package className="w-8 h-8 opacity-30" />
                        <span className="text-xs">No products found</span>
                      </div>
                    ) : (
                      filteredProds.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleProductUse(p)}
                          title="Use this price in the calculator"
                          className="w-full text-left flex items-start justify-between gap-2 p-2 rounded-lg border border-border hover:bg-accent/40 active:bg-accent/60 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium leading-tight line-clamp-2">
                              {p.product_name}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                              <span className="font-mono">{p.sku}</span>
                              {p.category_id && categoryMap.has(p.category_id) && (
                                <Badge variant="secondary" className="text-[9px] py-0 px-1 leading-tight">
                                  {categoryMap.get(p.category_id)}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs font-semibold text-primary">
                              {formatINR(Number(p.net_price))}
                            </div>
                            <div className="text-[9px] text-muted-foreground">tap to use</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Product count hint */}
                  {!loadingProds && filteredProds.length > 0 && (
                    <div className="text-center text-[10px] text-muted-foreground py-1.5 border-t border-border shrink-0">
                      {filteredProds.length} product{filteredProds.length !== 1 ? "s" : ""}
                      {products.length > 120 && filteredProds.length === 120 ? " (refine to see more)" : ""}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default FloatingDiscountCalculator;

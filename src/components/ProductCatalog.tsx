import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, Loader2 } from "lucide-react";

interface CatalogProduct {
  id: string;
  sku: string;
  product_name: string;
  category_id: string | null;
  hsn_code: string | null;
  line_code: string | null;
  brand_code: string | null;
  net_price: number;
}

interface Category {
  id: string;
  name: string;
}

const formatINR = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: n % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

interface Props {
  /** Optional callback when a product is tapped (e.g. to attach to a lead). */
  onSelect?: (product: CatalogProduct) => void;
  /** Show as a compact picker (no card chrome). */
  embedded?: boolean;
}

const ProductCatalog = ({ onSelect, embedded = false }: Props) => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Debounce search 300ms for fast typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [prodRes, catRes] = await Promise.all([
        (supabase as any)
          .from("products")
          .select("id,sku,product_name,category_id,hsn_code,line_code,brand_code,net_price")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("product_name", { ascending: true })
          .limit(5000),
        (supabase as any)
          .from("categories")
          .select("id,name")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("name"),
      ]);
      if (cancelled) return;
      setProducts((prodRes.data ?? []) as CatalogProduct[]);
      setCategories((catRes.data ?? []) as Category[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach(c => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (categoryFilter !== "all" && p.category_id !== categoryFilter) return false;
      if (!search) return true;
      return (
        p.sku.toLowerCase().includes(search) ||
        p.product_name.toLowerCase().includes(search) ||
        (p.line_code ?? "").toLowerCase().includes(search) ||
        (p.brand_code ?? "").toLowerCase().includes(search)
      );
    });
  }, [products, search, categoryFilter]);

  // Cap render to 200 items for snappy mobile scroll.
  const visible = filtered.slice(0, 200);

  const Filters = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search SKU, name, code..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
        <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {categories.map(c => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const List = (
    <div className="space-y-2">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          {search || categoryFilter !== "all"
            ? "No products match your filters."
            : "No products available yet."}
        </div>
      ) : (
        <>
          {visible.map(p => {
            const inner = (
              <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border hover:bg-accent/40 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm leading-tight line-clamp-2">{p.product_name}</div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-muted-foreground">{p.sku}</span>
                    {p.category_id && categoryMap.has(p.category_id) && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                        {categoryMap.get(p.category_id)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-sm">{formatINR(Number(p.net_price))}</div>
                  <div className="text-[10px] text-muted-foreground">incl. GST</div>
                </div>
              </div>
            );
            return onSelect ? (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className="block w-full text-left"
              >
                {inner}
              </button>
            ) : (
              <div key={p.id}>{inner}</div>
            );
          })}
          {filtered.length > visible.length && (
            <p className="text-center text-xs text-muted-foreground pt-2">
              Showing first {visible.length} of {filtered.length}. Refine search to narrow.
            </p>
          )}
        </>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="space-y-3">
        {Filters}
        {List}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-auto">
            <Package className="w-5 h-5 text-primary" />
            <CardTitle>Product Catalog{!loading && ` (${filtered.length})`}</CardTitle>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {Filters}
        </div>
      </CardHeader>
      <CardContent>{List}</CardContent>
    </Card>
  );
};

export default ProductCatalog;

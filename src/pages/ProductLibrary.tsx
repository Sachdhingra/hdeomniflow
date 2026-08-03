import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ShoppingCart, Loader2, PackageSearch } from "lucide-react";
import StorageImage from "@/components/product-library/StorageImage";
import ProductDetailDialog from "@/components/product-library/ProductDetailDialog";
import QuoteDrawer from "@/components/product-library/QuoteDrawer";
import { useQuote } from "@/contexts/QuoteContext";
import {
  plDb,
  money,
  effectivePrice,
  PLCategory,
  PLCollection,
  PLProduct,
} from "@/lib/productLibrary";

const ProductLibrary = () => {
  const { count, setOpen } = useQuote();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<PLCategory[]>([]);
  const [collections, setCollections] = useState<PLCollection[]>([]);
  const [products, setProducts] = useState<PLProduct[]>([]);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [collectionId, setCollectionId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState<PLProduct | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [cat, col, prod] = await Promise.all([
        plDb.from("pl_categories").select("*").eq("is_active", true).order("sort_order"),
        plDb.from("pl_collections").select("*").eq("is_active", true).order("sort_order"),
        plDb.from("pl_products").select("*").eq("is_active", true).order("sort_order"),
      ]);
      setCategories(cat.data || []);
      setCollections(col.data || []);
      setProducts(prod.data || []);
      setLoading(false);
    })();
  }, []);

  const visibleCollections = useMemo(
    () => collections.filter((c) => categoryId === "all" || c.category_id === categoryId),
    [collections, categoryId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = products.filter((p) => {
      if (categoryId !== "all" && p.category_id !== categoryId) return false;
      if (collectionId !== "all" && p.collection_id !== collectionId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "price_low") return effectivePrice(a) - effectivePrice(b);
      if (sort === "price_high") return effectivePrice(b) - effectivePrice(a);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [products, categoryId, collectionId, search, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Product Library</h1>
          <p className="text-sm text-muted-foreground">
            Master catalogue for quotations, website and customer apps.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <ShoppingCart className="w-4 h-4 mr-1" /> Quote
          {count > 0 && <Badge className="ml-2">{count}</Badge>}
        </Button>
      </div>

      {/* Category navigation */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={categoryId === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setCategoryId("all");
            setCollectionId("all");
          }}
        >
          All Categories
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={categoryId === c.id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setCategoryId(c.id);
              setCollectionId("all");
            }}
          >
            {c.name}
          </Button>
        ))}
      </div>

      {/* Collection navigation */}
      {visibleCollections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={collectionId === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCollectionId("all")}
          >
            All Collections
          </Button>
          {visibleCollections.map((c) => (
            <Button
              key={c.id}
              variant={collectionId === c.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCollectionId(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      )}

      {/* Search + sort */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A–Z</SelectItem>
            <SelectItem value="price_low">Price: Low to High</SelectItem>
            <SelectItem value="price_high">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
          <PackageSearch className="w-8 h-8" />
          <p className="text-sm">No products found.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const price = effectivePrice(p);
            return (
              <Card
                key={p.id}
                className="overflow-hidden cursor-pointer transition hover:shadow-lg"
                onClick={() => setSelected(p)}
              >
                <StorageImage
                  path={p.thumbnail_url || p.hero_image_url}
                  alt={p.name}
                  className="w-full aspect-square object-cover"
                />
                <CardContent className="p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">{p.sku}</p>
                  <p className="font-medium leading-tight line-clamp-2">{p.name}</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold">{money(price)}</span>
                    {p.mrp > price && (
                      <span className="text-xs line-through text-muted-foreground">
                        {money(p.mrp)}
                      </span>
                    )}
                  </div>
                  {p.elite_card_eligible && (
                    <Badge className="bg-amber-500 text-xs">Elite Card</Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProductDetailDialog product={selected} onClose={() => setSelected(null)} />
      <QuoteDrawer />
    </div>
  );
};

export default ProductLibrary;

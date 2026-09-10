import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Search, Loader2, PackageSearch } from "lucide-react";
import { plDb, money } from "@/lib/productLibrary";
import { useQuote } from "@/contexts/QuoteContext";
import { toast } from "@/lib/toast";

interface InvResult {
  id: string;
  sku: string;
  product_name: string;
  net_price: number;
  photo_url: string | null;
}

const AddFromInventory = () => {
  const { addItem } = useQuote();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        let q = plDb
          .from("products")
          .select("id, sku, product_name, net_price")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("product_name")
          .limit(25);
        const term = query.trim();
        if (term) {
          q = q.or(`product_name.ilike.%${term}%,sku.ilike.%${term}%`);
        }
        const { data, error } = await q;
        if (error) throw error;
        const ids = (data || []).map((p: any) => p.id);
        let photos: Record<string, string> = {};
        if (ids.length) {
          const { data: photoRows } = await plDb
            .from("hde_product_photos")
            .select("product_id, photo_url")
            .in("product_id", ids);
          photos = Object.fromEntries((photoRows || []).map((r: any) => [r.product_id, r.photo_url]));
        }
        setResults((data || []).map((p: any) => ({ ...p, photo_url: photos[p.id] || null })));
      } catch (e: any) {
        toast.error(e.message || "Inventory search failed");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  const pick = (p: InvResult) => {
    addItem({
      product_id: null,
      variant_id: null,
      image_url: p.photo_url,
      product_name: p.product_name,
      sku: p.sku,
      description: null,
      quantity: 1,
      unit_price: Number(p.net_price) || 0,
      gst_percent: 18,
    });
    toast.success(`Added ${p.product_name}`);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-muted-foreground font-normal">
          <Search className="w-4 h-4 mr-2 shrink-0" /> Add product from Inventory…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or SKU…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading && (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && <CommandEmpty>No matching products.</CommandEmpty>}
            <CommandGroup>
              {results.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => pick(p)}
                  className="flex items-center gap-2"
                >
                  <PackageSearch className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{p.product_name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <span className="text-xs font-medium shrink-0">{money(p.net_price)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default AddFromInventory;

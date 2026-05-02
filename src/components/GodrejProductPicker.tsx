import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink } from "lucide-react";

interface GodrejProduct {
  id: string;
  category: string;
  name: string;
  price: string | null;
  image_url: string | null;
  product_url: string;
}

interface Props {
  value: string;
  onChange: (text: string, picked?: GodrejProduct) => void;
  placeholder?: string;
}

/**
 * Lightweight typeahead: types feed `productViewed` as before,
 * but suggestions from `godrej_products` appear when typing 2+ chars.
 */
export default function GodrejProductPicker({ value, onChange, placeholder }: Props) {
  const [results, setResults] = useState<GodrejProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<GodrejProduct | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!value || value.length < 2 || picked?.name === value) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("godrej_products")
        .select("id, category, name, price, image_url, product_url")
        .eq("active", true)
        .ilike("name", `%${value}%`)
        .limit(8);
      if (!cancelled) {
        setResults(data || []);
        setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, picked]);

  const showList = open && results.length > 0;

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          setPicked(null);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "e.g. L-shape sofa"}
      />
      {loading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      {showList && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2"
              onMouseDown={(e) => {
                e.preventDefault();
                setPicked(r);
                onChange(r.name, r);
                setOpen(false);
              }}
            >
              {r.image_url ? (
                <img src={r.image_url} alt="" className="h-8 w-8 rounded object-cover" />
              ) : (
                <div className="h-8 w-8 rounded bg-muted" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.category}{r.price ? ` · ${r.price}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {picked && (
        <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
          <span>Godrej · {picked.category}</span>
          <a
            href={picked.product_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline"
          >
            view <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

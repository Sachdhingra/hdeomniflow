import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { quoteTotals } from "@/lib/productLibrary";
import { lookupWebsiteImage } from "@/lib/websiteCatalog";

export interface QuoteLine {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  image_url: string | null;
  /** "website" when the photo came from the HDE website catalogue, "manual" when staff supplied it. */
  image_source?: "website" | "manual" | null;
  product_name: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  /** GST-inclusive price, as stored in Omniflow. */
  unit_price: number;
  gst_percent: number;
  discount_percent?: number;
}

interface QuoteCtx {
  items: QuoteLine[];
  /** `lookupCodes`: extra item codes (e.g. the Interio line code) to match on the website. */
  addItem: (item: Omit<QuoteLine, "id">, lookupCodes?: (string | null | undefined)[]) => void;
  updateItem: (id: string, patch: Partial<QuoteLine>) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<QuoteCtx | undefined>(undefined);
const KEY = "hde_quote_cart_v1";

export const QuoteProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<QuoteLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const updateItem: QuoteCtx["updateItem"] = (id, patch) =>
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  /** Website photo takes priority; a photo staff picked by hand is never replaced. */
  const applyWebsiteImage = async (
    id: string,
    line: Pick<QuoteLine, "sku" | "product_name">,
    lookupCodes: (string | null | undefined)[] = [],
  ) => {
    const url = await lookupWebsiteImage({ codes: [line.sku, ...lookupCodes], name: line.product_name });
    if (!url) return;
    setItems((prev) =>
      prev.map((p) =>
        p.id === id && p.image_source !== "manual"
          ? { ...p, image_url: url, image_source: "website" }
          : p,
      ),
    );
  };

  // Carts saved before website photos existed: look them up once.
  useEffect(() => {
    items
      .filter((i) => i.image_source === undefined)
      .forEach((i) => void applyWebsiteImage(i.id, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addItem: QuoteCtx["addItem"] = (item, lookupCodes) => {
    const id = crypto.randomUUID();
    setItems((prev) => {
      const match = prev.find(
        (p) => p.product_id === item.product_id && p.variant_id === item.variant_id && p.sku === item.sku,
      );
      if (match) {
        return prev.map((p) =>
          p.id === match.id ? { ...p, quantity: p.quantity + (item.quantity || 1) } : p,
        );
      }
      return [...prev, { ...item, image_source: item.image_source ?? null, id }];
    });
    // No-op when the line merged into an existing one (that line already had its lookup).
    void applyWebsiteImage(id, item, lookupCodes);
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  const clear = () => setItems([]);

  const totals = useMemo(() => quoteTotals(items), [items]);

  return (
    <Ctx.Provider
      value={{
        items,
        addItem,
        updateItem,
        removeItem,
        clear,
        count: items.reduce((s, i) => s + i.quantity, 0),
        ...totals,
        open,
        setOpen,
      }}
    >
      {children}
    </Ctx.Provider>
  );
};

export const useQuote = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useQuote must be used inside QuoteProvider");
  return ctx;
};

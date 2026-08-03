import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { lineTotal } from "@/lib/productLibrary";

export interface QuoteLine {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  image_url: string | null;
  product_name: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  discount_percent?: number;
}

interface QuoteCtx {
  items: QuoteLine[];
  addItem: (item: Omit<QuoteLine, "id">) => void;
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

  const addItem: QuoteCtx["addItem"] = (item) =>
    setItems((prev) => {
      const match = prev.find(
        (p) => p.product_id === item.product_id && p.variant_id === item.variant_id,
      );
      if (match) {
        return prev.map((p) =>
          p.id === match.id ? { ...p, quantity: p.quantity + (item.quantity || 1) } : p,
        );
      }
      return [...prev, { ...item, id: crypto.randomUUID() }];
    });

  const updateItem: QuoteCtx["updateItem"] = (id, patch) =>
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removeItem = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  const clear = () => setItems([]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const gstTotal = items.reduce(
      (s, i) => s + (i.quantity * i.unit_price * (i.gst_percent || 0)) / 100,
      0,
    );
    const grandTotal = items.reduce(
      (s, i) => s + lineTotal(i.quantity, i.unit_price, i.gst_percent),
      0,
    );
    return { subtotal, gstTotal, grandTotal };
  }, [items]);

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

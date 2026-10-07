import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { quoteTotals } from "@/lib/productLibrary";
import { lookupWebsiteImage } from "@/lib/websiteCatalog";
import { lookupInventoryPhoto } from "@/lib/inventoryPhotos";
import { EMPTY_META, type QuoteMeta } from "@/lib/savedQuotes";

export interface QuoteLine {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  image_url: string | null;
  /**
   * Where the photo came from. Order of preference: "website" (HDE website catalogue),
   * then "inventory" (Inventory Manager photo), then whatever the line came with.
   * "manual" (picked by staff) is never replaced.
   */
  image_source?: "website" | "inventory" | "manual" | null;
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
  /** Customer, lead and saved-quote details of the quote being drafted. */
  meta: QuoteMeta;
  setMeta: (patch: Partial<QuoteMeta>) => void;
  /** Open a saved quote for editing (replaces the current draft). */
  loadSaved: (meta: QuoteMeta, lines: QuoteLine[]) => void;
  /** Empty basket and details, ready for a new quote. */
  startNew: () => void;
  /** Look up website photos again for lines that don't have one (and weren't set by hand). */
  refreshWebsiteImages: () => void;
  count: number;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<QuoteCtx | undefined>(undefined);
const KEY = "hde_quote_cart_v1";
const META_KEY = "hde_quote_meta_v1";

export const QuoteProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<QuoteLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [meta, setMetaState] = useState<QuoteMeta>(() => {
    try {
      return { ...EMPTY_META, ...JSON.parse(localStorage.getItem(META_KEY) || "{}") };
    } catch {
      return EMPTY_META;
    }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }, [meta]);

  const setMeta = (patch: Partial<QuoteMeta>) => setMetaState((prev) => ({ ...prev, ...patch }));
  const loadSaved = (m: QuoteMeta, lines: QuoteLine[]) => {
    setMetaState(m);
    setItems(lines);
  };
  const startNew = () => {
    setMetaState(EMPTY_META);
    setItems([]);
  };

  const updateItem: QuoteCtx["updateItem"] = (id, patch) =>
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  /** 1st choice the website photo, 2nd the inventory photo; a photo staff picked by hand is never replaced. */
  const applyWebsiteImage = async (
    id: string,
    line: Pick<QuoteLine, "sku" | "product_name">,
    lookupCodes: (string | null | undefined)[] = [],
  ) => {
    const codes = [line.sku, ...lookupCodes];
    const website = await lookupWebsiteImage({ codes, name: line.product_name });
    if (website) {
      setItems((prev) =>
        prev.map((p) =>
          p.id === id && p.image_source !== "manual"
            ? { ...p, image_url: website, image_source: "website" }
            : p,
        ),
      );
      return;
    }
    const inventory = await lookupInventoryPhoto(codes);
    if (!inventory) return;
    setItems((prev) =>
      prev.map((p) =>
        p.id === id && p.image_source !== "manual" && p.image_source !== "website"
          ? { ...p, image_url: inventory, image_source: "inventory" }
          : p,
      ),
    );
  };

  const refreshWebsiteImages = () =>
    items
      // Inventory photos are retried too: the website photo is the first choice.
      .filter((i) => i.image_source !== "manual" && i.image_source !== "website")
      .forEach((i) => void applyWebsiteImage(i.id, i));

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
        meta,
        setMeta,
        loadSaved,
        startNew,
        refreshWebsiteImages,
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

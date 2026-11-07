import data from "@/data/kreationX3.json";
import type { QuoteLine } from "@/contexts/QuoteContext";

/** [item code, item description, long description, NETT price (GST included)] */
type RawItem = [string, string, string, number];
interface RawSection {
  name: string;
  items: RawItem[];
}
interface RawSheet {
  id: string;
  sections: RawSection[];
}

export interface X3Item {
  /** Unique within the whole price list: "<tab>|<code or description>". */
  key: string;
  code: string;
  description: string;
  longDescription: string;
  nett: number;
}
export interface X3Section {
  name: string;
  items: X3Item[];
}
export interface X3Tab {
  id: string;
  label: string;
  sections: X3Section[];
}

const TAB_LABELS: Record<string, string> = {
  "1900H": "1900H Wardrobe",
  "2500H": "2500H Wardrobe",
  "WINGLINE 2500H": "Wingline 2500H",
  "CHEST OF DRAWER": "Chest of Drawer",
};

/** The 2026 price list, one tab per sheet of the calculator workbook. Prices are nett only. */
export const X3_TABS: X3Tab[] = (data as RawSheet[]).map((s) => ({
  id: s.id,
  label: TAB_LABELS[s.id] ?? s.id,
  sections: s.sections.map((sec) => ({
    name: sec.name,
    items: sec.items.map(([code, description, longDescription, nett]) => ({
      key: `${s.id}|${code || description}`,
      code,
      description,
      longDescription,
      nett,
    })),
  })),
}));

export const X3_ITEMS: X3Item[] = X3_TABS.flatMap((t) => t.sections.flatMap((s) => s.items));
const BY_KEY = new Map(X3_ITEMS.map((i) => [i.key, i]));
export const x3ItemByKey = (key: string) => BY_KEY.get(key);

/** GST included in the nett price, used when the lines go onto a quotation. */
export const X3_GST_PERCENT = 18;

/** Selected quantities by item key. */
export type X3Quantities = Record<string, number>;

/** Amount for one line, whole rupees. */
export const x3LineAmount = (nett: number, qty: number) => Math.round(nett * qty);

export interface X3Totals {
  units: number;
  total: number;
  discountPercent: number;
  discount: number;
  amount: number;
}

/**
 * Every line is rounded to the rupee, the total is the sum of those lines, and one
 * discount applies to the total across all tabs. Discount and amount are whole rupees.
 */
export function x3Totals(quantities: X3Quantities, discountPercent: number): X3Totals {
  let units = 0;
  let total = 0;
  for (const [key, qty] of Object.entries(quantities)) {
    const item = BY_KEY.get(key);
    if (!item || !(qty > 0)) continue;
    units += qty;
    total += x3LineAmount(item.nett, qty);
  }
  const pct = Number.isFinite(discountPercent) ? Math.min(100, Math.max(0, discountPercent)) : 0;
  const discount = Math.round((total * pct) / 100);
  return { units, total, discountPercent: pct, discount, amount: total - discount };
}

export interface X3UnitsTotals {
  /** Totals of each unit, discount taken off each unit's own total. */
  units: X3Totals[];
  pieces: number;
  total: number;
  discountPercent: number;
  discount: number;
  amount: number;
}

/**
 * Totals for several Kreation units. One discount % applies to every unit. It is taken off each
 * unit's own total, because each unit appears on the customer copy with its own price, so the
 * grand amount is exactly the sum of those prices.
 */
export function x3UnitsTotals(units: X3Quantities[], discountPercent: number): X3UnitsTotals {
  const per = units.map((q) => x3Totals(q, discountPercent));
  return {
    units: per,
    pieces: per.reduce((s, u) => s + u.units, 0),
    total: per.reduce((s, u) => s + u.total, 0),
    discountPercent: x3Totals({}, discountPercent).discountPercent,
    discount: per.reduce((s, u) => s + u.discount, 0),
    amount: per.reduce((s, u) => s + u.amount, 0),
  };
}

/** Selected items in price-list order, for review and for the quotation. */
export function x3SelectedLines(quantities: X3Quantities) {
  return X3_TABS.flatMap((tab) =>
    tab.sections.flatMap((sec) =>
      sec.items
        .filter((i) => (quantities[i.key] || 0) > 0)
        .map((item) => ({ tab, section: sec.name, item, qty: quantities[item.key] })),
    ),
  );
}

export { isX3QuoteLine } from "@/lib/kreationX3Quote";

/**
 * Selected items of every unit as quotation lines; the single discount is carried on every
 * line. Empty units are skipped and the rest are numbered 1, 2, … in order.
 */
export function x3QuoteLines(units: X3Quantities[], discountPercent: number): Omit<QuoteLine, "id">[] {
  const pct = x3Totals({}, discountPercent).discountPercent;
  return units
    .map((q) => x3SelectedLines(q))
    .filter((sel) => sel.length > 0)
    .flatMap((sel, n) => sel.map(({ item, qty }) => ({ item, qty, unit: n + 1 })))
    .map(({ item, qty, unit }) => ({
      group_no: unit,
      product_id: null,
      variant_id: null,
      image_url: null,
      product_name: item.longDescription,
      sku: item.code || item.description,
      description: item.description,
      quantity: qty,
      unit_price: item.nett,
      gst_percent: X3_GST_PERCENT,
      discount_percent: pct,
    }));
}

/** Finish colours for the swatch next to an item, matched on its long description. */
const FINISHES: { name: string; match: RegExp; color: string }[] = [
  { name: "Alpine White", match: /alpine white/i, color: "#f4f3ef" },
  { name: "Magnolia", match: /magnolia/i, color: "#e6d9bd" },
  { name: "Walnut", match: /walnut/i, color: "#6a4a33" },
  { name: "Shellwine Red", match: /shellwine red/i, color: "#7d2c36" },
  { name: "Sepia Brown", match: /sepia brown/i, color: "#5a4234" },
  { name: "Stone Ext.", match: /stone ext/i, color: "#b9b2a4" },
  { name: "White Ext.", match: /white ext/i, color: "#fbfbfa" },
];
export const x3Finish = (longDescription: string) => FINISHES.find((f) => f.match.test(longDescription)) ?? null;

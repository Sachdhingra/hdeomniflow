import { lineTotal } from "@/lib/productLibrary";
import type { QuoteLine } from "@/contexts/QuoteContext";

/**
 * Customer copy of a Kreation X3 quotation. The internal quote lists every part with its
 * item code; the customer copy collapses those parts into one line named after the layout,
 * with the dimensions covered and a single price. Kept free of the price-list data so the
 * quotation code that loads on every page stays small.
 */

export type X3LayoutId = "straight" | "l-shape" | "u-shape" | "parallel";

export const X3_LAYOUTS: { id: X3LayoutId; label: string }[] = [
  { id: "straight", label: "Kreation X3 Straight" },
  { id: "l-shape", label: "Kreation X3 L-Shape" },
  { id: "u-shape", label: "Kreation X3 U-Shape" },
  { id: "parallel", label: "Kreation X3 Parallel" },
];

export const x3LayoutLabel = (id: X3LayoutId | null | undefined) => X3_LAYOUTS.find((l) => l.id === id)?.label ?? null;

/** A quotation line that came from the Kreation X3 calculator (every price-list item is named KreX3…). */
export const isX3QuoteLine = (l: Pick<QuoteLine, "product_id" | "description">) =>
  l.product_id === null && /^KreX3/.test(l.description || "");

/** The line whose photo is shown on the customer copy: the first one that has a photo, else the first. */
export function x3PhotoLine(lines: QuoteLine[]): QuoteLine | null {
  const x3 = lines.filter(isX3QuoteLine);
  return x3.find((l) => l.image_url) ?? x3[0] ?? null;
}

/**
 * The price on the customer copy. With one discount on every part (what the calculator sets) it
 * is worked out exactly as the calculator does, so both show the same amount: each line rounded
 * to the rupee, then the discount taken off the sum. If parts were given different discounts
 * in the quotation, their discounted totals are added and rounded.
 */
function x3Amount(x3: QuoteLine[]): number {
  const pcts = new Set(x3.map((l) => l.discount_percent || 0));
  if (pcts.size === 1) {
    const pct = [...pcts][0];
    const sum = x3.reduce((s, l) => s + Math.round(l.unit_price * l.quantity), 0);
    return sum - Math.round((sum * pct) / 100);
  }
  return Math.round(x3.reduce((s, l) => s + lineTotal(l.quantity, l.unit_price, l.gst_percent, l.discount_percent || 0), 0));
}

/**
 * Lines for the customer copy: all Kreation X3 parts become one line (at the position of the
 * first part) priced at their combined, discounted, GST-inclusive total in whole rupees.
 * Other products stay as they are.
 */
export function customerCopyLines(lines: QuoteLine[], layout: X3LayoutId, dimensions: string): QuoteLine[] {
  const x3 = lines.filter(isX3QuoteLine);
  if (!x3.length) return lines;
  const total = x3Amount(x3);
  const photo = x3PhotoLine(lines);
  const merged: QuoteLine = {
    id: x3[0].id,
    product_id: null,
    variant_id: null,
    image_url: photo?.image_url ?? null,
    image_source: photo?.image_source ?? null,
    product_name: x3LayoutLabel(layout) ?? "Kreation X3",
    sku: null,
    description: null,
    details: dimensions.trim() || null,
    quantity: 1,
    unit_price: total,
    gst_percent: x3[0].gst_percent,
    discount_percent: 0,
  };
  const out: QuoteLine[] = [];
  let placed = false;
  for (const l of lines) {
    if (!isX3QuoteLine(l)) out.push(l);
    else if (!placed) {
      out.push(merged);
      placed = true;
    }
  }
  return out;
}

/** The layout and dimensions are saved in the quote's free-text notes column, so no schema change is needed. */
const NOTES_PREFIX = "x3layout:";

export function encodeX3Notes(layout: X3LayoutId | null, dimensions: string): string | null {
  if (!layout && !dimensions.trim()) return null;
  return NOTES_PREFIX + JSON.stringify({ layout, dimensions: dimensions.trim() });
}

export function decodeX3Notes(notes: string | null | undefined): { layout: X3LayoutId | null; dimensions: string } {
  if (!notes || !notes.startsWith(NOTES_PREFIX)) return { layout: null, dimensions: "" };
  try {
    const raw = JSON.parse(notes.slice(NOTES_PREFIX.length));
    const layout = X3_LAYOUTS.some((l) => l.id === raw.layout) ? (raw.layout as X3LayoutId) : null;
    return { layout, dimensions: typeof raw.dimensions === "string" ? raw.dimensions : "" };
  } catch {
    return { layout: null, dimensions: "" };
  }
}

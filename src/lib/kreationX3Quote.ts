import { lineTotal } from "@/lib/productLibrary";
import type { QuoteLine } from "@/contexts/QuoteContext";

/**
 * Customer copy of a Kreation X3 quotation. The internal quote lists every part with its
 * item code; the customer copy collapses the parts of each Kreation unit (one wardrobe or
 * layout) into one line named after the layout, with the dimensions covered, the photo and a
 * single price. A quote can hold several units. Kept free of the price-list data so the
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

/** What sales fill in for one Kreation unit. */
export interface X3UnitInfo {
  layout: X3LayoutId | null;
  dimensions: string;
}
/** Per unit number (1, 2, …). */
export type X3Units = Record<number, X3UnitInfo>;

/** A quotation line that came from the Kreation X3 calculator (every price-list item is named KreX3…). */
export const isX3QuoteLine = (l: Pick<QuoteLine, "product_id" | "description">) =>
  l.product_id === null && /^KreX3/.test(l.description || "");

/** Unit a Kreation line belongs to. Lines saved before units existed are unit 1. */
export const x3UnitNo = (l: Pick<QuoteLine, "group_no">) => (l.group_no && l.group_no > 0 ? l.group_no : 1);

/** Unit numbers present on the quotation, in order. */
export function x3UnitNumbers(lines: QuoteLine[]): number[] {
  return [...new Set(lines.filter(isX3QuoteLine).map(x3UnitNo))].sort((a, b) => a - b);
}

/** The line whose photo is shown for a unit: its first line that has a photo, else its first line. */
export function x3PhotoLine(lines: QuoteLine[], unit = 1): QuoteLine | null {
  const mine = lines.filter((l) => isX3QuoteLine(l) && x3UnitNo(l) === unit);
  return mine.find((l) => l.image_url) ?? mine[0] ?? null;
}

/** Customer-copy lines are built by `customerCopyLines` and carry this id prefix. */
export const isX3CustomerLine = (l: Pick<QuoteLine, "id">) => l.id.startsWith("x3u-");

/** Units that still need a layout before the customer copy can go out. */
export const x3UnitsMissingLayout = (lines: QuoteLine[], units: X3Units) =>
  x3UnitNumbers(lines).filter((n) => !units[n]?.layout);

/**
 * The price of one unit on the customer copy. With one discount on every part (what the
 * calculator sets) it is worked out exactly as the calculator does, so both show the same
 * amount: each line rounded to the rupee, then the discount taken off the sum. If parts were
 * given different discounts in the quotation, their discounted totals are added and rounded.
 */
function x3Amount(parts: QuoteLine[]): number {
  const pcts = new Set(parts.map((l) => l.discount_percent || 0));
  if (pcts.size === 1) {
    const pct = [...pcts][0];
    const sum = parts.reduce((s, l) => s + Math.round(l.unit_price * l.quantity), 0);
    return sum - Math.round((sum * pct) / 100);
  }
  return Math.round(
    parts.reduce((s, l) => s + lineTotal(l.quantity, l.unit_price, l.gst_percent, l.discount_percent || 0), 0),
  );
}

/**
 * Lines for the customer copy: the parts of each Kreation unit become one line (at the
 * position of the unit's first part) priced at the unit's discounted, GST-inclusive total in
 * whole rupees, with the unit's own layout name, dimensions and photo. Other products stay.
 */
export function customerCopyLines(lines: QuoteLine[], units: X3Units): QuoteLine[] {
  const byUnit = new Map<number, QuoteLine[]>();
  for (const l of lines) if (isX3QuoteLine(l)) byUnit.set(x3UnitNo(l), [...(byUnit.get(x3UnitNo(l)) ?? []), l]);
  if (!byUnit.size) return lines;

  const out: QuoteLine[] = [];
  const placed = new Set<number>();
  for (const l of lines) {
    if (!isX3QuoteLine(l)) {
      out.push(l);
      continue;
    }
    const n = x3UnitNo(l);
    if (placed.has(n)) continue;
    placed.add(n);
    const parts = byUnit.get(n)!;
    const photo = x3PhotoLine(lines, n);
    out.push({
      id: `x3u-${n}`,
      product_id: null,
      variant_id: null,
      image_url: photo?.image_url ?? null,
      image_source: photo?.image_source ?? null,
      product_name: x3LayoutLabel(units[n]?.layout) ?? "Kreation X3",
      sku: null,
      description: null,
      details: units[n]?.dimensions.trim() || null,
      quantity: 1,
      unit_price: x3Amount(parts),
      gst_percent: parts[0].gst_percent,
      discount_percent: 0,
    });
  }
  return out;
}

/**
 * The internal copy keeps every part and its code. With more than one unit, each part also
 * says which unit it belongs to, so staff can tell them apart.
 */
export function internalCopyLines(lines: QuoteLine[]): QuoteLine[] {
  if (x3UnitNumbers(lines).length < 2) return lines;
  return lines.map((l) => (isX3QuoteLine(l) ? { ...l, details: `${l.sku || ""} · Unit ${x3UnitNo(l)}` } : l));
}

/** Layouts and dimensions are saved in the quote's free-text notes column, so no extra column is needed for them. */
const NOTES_PREFIX = "x3layout:";

export function encodeX3Notes(units: X3Units): string | null {
  const clean: Record<string, X3UnitInfo> = {};
  for (const [n, u] of Object.entries(units)) {
    if (u.layout || u.dimensions.trim()) clean[n] = { layout: u.layout, dimensions: u.dimensions.trim() };
  }
  return Object.keys(clean).length ? NOTES_PREFIX + JSON.stringify({ units: clean }) : null;
}

const validLayout = (v: unknown): X3LayoutId | null =>
  X3_LAYOUTS.some((l) => l.id === v) ? (v as X3LayoutId) : null;

export function decodeX3Notes(notes: string | null | undefined): X3Units {
  if (!notes || !notes.startsWith(NOTES_PREFIX)) return {};
  try {
    const raw = JSON.parse(notes.slice(NOTES_PREFIX.length));
    const info = (u: { layout?: unknown; dimensions?: unknown }): X3UnitInfo => ({
      layout: validLayout(u?.layout),
      dimensions: typeof u?.dimensions === "string" ? u.dimensions : "",
    });
    if (raw && typeof raw.units === "object" && raw.units) {
      const out: X3Units = {};
      for (const [k, u] of Object.entries(raw.units as Record<string, { layout?: unknown; dimensions?: unknown }>)) {
        const n = Number(k);
        if (Number.isInteger(n) && n > 0) out[n] = info(u);
      }
      return out;
    }
    // Saved by the first version: one layout for the whole quote.
    return "layout" in raw || "dimensions" in raw ? { 1: info(raw) } : {};
  } catch {
    return {};
  }
}

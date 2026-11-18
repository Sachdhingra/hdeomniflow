/**
 * How a furniture quotation shows prices to the customer.
 * - "breakup": basic price excl. GST, special price, GST, price incl. GST (the original format).
 * - "inclusive": MRP, discount and final rate, all GST-inclusive, with no GST breakup, for
 *   customers who want one all-inclusive price.
 * Kreation X3 quotes keep their own layout and ignore this.
 */
export type QuotePriceFormat = "breakup" | "inclusive";

export const QUOTE_PRICE_FORMATS: { value: QuotePriceFormat; label: string; hint: string }[] = [
  { value: "breakup", label: "With GST breakup", hint: "Basic price, GST and price incl. GST" },
  { value: "inclusive", label: "GST inclusive", hint: "MRP, discount and final rate only" },
];

const KEY = "hde_quote_price_format";

/** The quote type this salesperson used last (per device). */
export function rememberedPriceFormat(): QuotePriceFormat {
  try {
    return localStorage.getItem(KEY) === "inclusive" ? "inclusive" : "breakup";
  } catch {
    return "breakup";
  }
}

export function rememberPriceFormat(format: QuotePriceFormat) {
  try {
    localStorage.setItem(KEY, format);
  } catch {
    /* storage unavailable: just don't remember */
  }
}

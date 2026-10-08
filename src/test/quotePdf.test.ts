import { describe, expect, it } from "vitest";
import { buildQuotePdf } from "@/lib/quotePdf";

const meta = {
  customerName: "Test Customer",
  billingAddress: "Dehradun",
  deliveryAddress: "Dehradun",
  quoteNumber: "HDE/Dehradun/2026-27/1001",
  quoteDate: "06/10/2026",
  handlingCharges: 0,
  contactLine: "CONTACT",
};
const line = (i: number) => ({
  image_url: null,
  product_name: `Product ${i}`,
  sku: `SKU${i}`,
  unit_price: 11800,
  discount_percent: 0,
  gst_percent: 18,
  quantity: 1,
});

describe("letterhead quotation PDF", () => {
  it("puts the quote and its terms on letterhead pages", () => {
    const doc = buildQuotePdf([line(1)], meta, { letterhead: null, images: [null] });
    // Quote page(s) + a terms page.
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it("carries long quotes over to more pages", () => {
    const short = buildQuotePdf([line(1)], meta, { letterhead: null, images: [null] }).getNumberOfPages();
    const lines = Array.from({ length: 25 }, (_, i) => line(i));
    const long = buildQuotePdf(lines, meta, { letterhead: null, images: lines.map(() => null) }).getNumberOfPages();
    expect(long).toBeGreaterThan(short);
  });
});

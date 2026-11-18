import { describe, expect, it } from "vitest";
import { buildQuoteWorkbook } from "@/lib/quoteExcel";
import { buildQuotePdf } from "@/lib/quotePdf";

const meta = {
  customerName: "Test Customer",
  billingAddress: "Dehradun",
  deliveryAddress: "Dehradun",
  quoteNumber: "HDE/Dehradun/2026-27/1001",
  quoteDate: "18/11/2026",
  handlingCharges: 0,
  contactLine: "CONTACT",
};
const line = {
  image_url: null,
  product_name: "Versailles sofabed fab Ash",
  sku: "NEW2025-56101502SD04747",
  unit_price: 155251,
  discount_percent: 25,
  gst_percent: 18,
  quantity: 2,
};
const result = (v: unknown) => (typeof v === "object" && v && "result" in v ? (v as { result: number }).result : v);

describe("furniture quote types", () => {
  it("GST inclusive Excel shows MRP, discount and final rate, with no GST columns", async () => {
    const wb = await buildQuoteWorkbook([line], { ...meta, priceFormat: "inclusive" });
    const ws = wb.getWorksheet("Quote")!;
    expect(ws.getCell("F9").value).toBe("MRP\n(INCL. GST)");
    expect(ws.getCell("G9").value).toBe("DISCOUNT");
    expect(ws.getCell("H9").value).toBe("FINAL RATE\n(INCL. GST)");
    expect(ws.getCell("F11").value).toBe(155251);
    expect(ws.getCell("G11").value).toBe(0.25);
    expect(result(ws.getCell("H11").value)).toBeCloseTo(116438.25, 2);
    expect(result(ws.getCell("K11").value)).toBeCloseTo(232876.5, 2);
    const text = JSON.stringify(ws.getSheetValues());
    expect(text).not.toContain("EXCL. GST");
    expect(text).not.toContain("GST PRICE");
  });

  it("GST breakup Excel is unchanged by default", async () => {
    const wb = await buildQuoteWorkbook([line], meta);
    const ws = wb.getWorksheet("Quote")!;
    expect(ws.getCell("F9").value).toBe("UNIT PRICE\n(EXCL. GST)");
    expect(ws.getCell("H9").value).toBe("GST PRICE");
    // Same customer price in both types.
    expect(result(ws.getCell("I11").value)).toBeCloseTo(116438.25, 2);
  });

  it("builds both PDF types", () => {
    for (const priceFormat of ["breakup", "inclusive"] as const) {
      const doc = buildQuotePdf([line], { ...meta, priceFormat }, { letterhead: null, images: [null] });
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    }
  });
});

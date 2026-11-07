import { describe, expect, it } from "vitest";
import {
  X3_ITEMS,
  X3_TABS,
  isX3QuoteLine,
  x3ItemByKey,
  x3LineAmount,
  x3QuoteLines,
  x3Totals,
} from "@/lib/kreationX3";
import { quoteTotals } from "@/lib/productLibrary";
import { buildQuotePdf } from "@/lib/quotePdf";
import { buildQuoteWorkbook } from "@/lib/quoteExcel";
import {
  customerCopyLines,
  decodeX3Notes,
  encodeX3Notes,
  x3PhotoLine,
} from "@/lib/kreationX3Quote";
import type { QuoteLine } from "@/contexts/QuoteContext";

const keyOf = (code: string, tab?: string) =>
  X3_ITEMS.find((i) => i.code === code && (!tab || i.key.startsWith(`${tab}|`)))!.key;

describe("Kreation X3 price list", () => {
  it("has every item of the four workbook sheets", () => {
    expect(X3_TABS.map((t) => [t.id, t.sections.reduce((n, s) => n + s.items.length, 0)])).toEqual([
      ["1900H", 236],
      ["2500H", 241],
      ["WINGLINE 2500H", 30],
      ["CHEST OF DRAWER", 12],
    ]);
    expect(new Set(X3_ITEMS.map((i) => i.key)).size).toBe(X3_ITEMS.length);
  });

  it("keeps nett as CPL x 1.18 x 1.11 x 1.05 x 1.0975 (first 1900H body)", () => {
    expect(X3_ITEMS[0].code).toBe("30161803SD01067");
    expect(X3_ITEMS[0].nett).toBeCloseTo(24647 * 1.18 * 1.11 * 1.05 * 1.0975, 2);
  });

  it("gives the 1200W chest of drawer body its item code", () => {
    const body = X3_ITEMS.find((i) => i.description === "KreX3ChestDwBd1200WAlWh")!;
    expect(body.code).toBe("30161803SD01265");
  });

  it("rounds the single locker prices to the rupee and leaves descriptions alone", () => {
    for (const tab of ["1900H", "2500H"]) {
      expect(x3ItemByKey(`${tab}|30161803SD01285`)!.nett).toBe(10186);
      expect(x3ItemByKey(`${tab}|30161803SD01286`)!.nett).toBe(12119);
    }
    expect(X3_ITEMS.find((i) => i.code === "30161803SD01287")!.longDescription).toBe(
      "Kreation X3 Single Locker Body 900W Alpine White",
    );
  });
});

describe("Kreation X3 totals", () => {
  it("rounds each line, sums them, then applies one discount across tabs", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const b = keyOf("30161803SD01265", "CHEST OF DRAWER");
    const t = x3Totals({ [a]: 3, [b]: 2 }, 7.5);
    expect(t.units).toBe(5);
    expect(t.total).toBe(Math.round(37201.708 * 3) + Math.round(54257.7107 * 2)); // 220120
    expect(t.total).toBe(220120);
    expect(t.discount).toBe(16509);
    expect(t.amount).toBe(203611);
  });

  it("ignores zero quantities and clamps the discount to 0-100", () => {
    const a = keyOf("30161803SD01067", "1900H");
    expect(x3Totals({ [a]: 0 }, 10).total).toBe(0);
    expect(x3Totals({ [a]: 1 }, 150).amount).toBe(0);
    expect(x3Totals({ [a]: 1 }, -5).discount).toBe(0);
    expect(x3Totals({ [a]: 1 }, NaN).discountPercent).toBe(0);
    expect(x3LineAmount(10185.8975, 3)).toBe(30558);
  });
});

describe("Kreation X3 quotation lines", () => {
  it("carries the code, nett price, GST and the single discount on every line", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const lines = x3QuoteLines({ [a]: 2 }, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      product_id: null,
      sku: "30161803SD01067",
      quantity: 2,
      gst_percent: 18,
      discount_percent: 10,
      product_name: "Kreation X3 Main Body 1200W 560D 1900H Alpine White",
    });
    expect(lines[0].unit_price).toBeCloseTo(37201.708, 3);
    expect(isX3QuoteLine({ product_id: null, description: lines[0].description })).toBe(true);
    expect(isX3QuoteLine({ product_id: "p1", description: lines[0].description })).toBe(false);
    expect(isX3QuoteLine({ product_id: null, description: "Some other product" })).toBe(false);
  });

  it("lands within a rupee per line of the calculator amount on the quotation", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const b = keyOf("30161803SD01265", "CHEST OF DRAWER");
    const sel = { [a]: 3, [b]: 2 };
    const q = quoteTotals(x3QuoteLines(sel, 7.5));
    expect(Math.abs(q.grandTotal - x3Totals(sel, 7.5).amount)).toBeLessThanOrEqual(2);
  });
});

describe("Kreation X3 customer copy", () => {
  const asQuote = (sel: Record<string, number>, disc: number, extra: Partial<QuoteLine>[] = []): QuoteLine[] =>
    x3QuoteLines(sel, disc).map((l, i) => ({ ...l, id: `x${i}`, ...(extra[i] || {}) }));
  const sel = () => ({ [keyOf("30161803SD01067", "1900H")]: 3, [keyOf("30161803SD01265", "CHEST OF DRAWER")]: 2 });
  const other: QuoteLine = {
    id: "o1", product_id: "p1", variant_id: null, image_url: null, product_name: "Sofa", sku: "SOFA1",
    description: "Sofa", quantity: 1, unit_price: 11800, gst_percent: 18,
  };

  it("collapses the parts into one layout line at the calculator amount, with no codes", () => {
    const lines = asQuote(sel(), 7.5);
    const out = customerCopyLines(lines, "l-shape", " Wall A 8 ft + Wall B 6 ft ");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      product_name: "Kreation X3 L-Shape",
      details: "Wall A 8 ft + Wall B 6 ft",
      sku: null,
      description: null,
      quantity: 1,
      discount_percent: 0,
    });
    expect(out[0].unit_price).toBe(x3Totals(sel(), 7.5).amount);
    expect(quoteTotals(out).grandTotal).toBeCloseTo(x3Totals(sel(), 7.5).amount, 2);
  });

  it("keeps other products, puts the layout where the first part was, and leaves the original lines alone", () => {
    const lines = [other, ...asQuote(sel(), 0)];
    const out = customerCopyLines(lines, "u-shape", "");
    expect(out.map((l) => l.product_name)).toEqual(["Sofa", "Kreation X3 U-Shape"]);
    expect(out[1].details).toBeNull();
    expect(lines).toHaveLength(3);
    expect(lines[1].sku).toBe("30161803SD01067");
    expect(customerCopyLines([other], "straight", "")).toEqual([other]);
  });

  it("falls back to the discounted sum when parts carry different discounts", () => {
    const lines = asQuote(sel(), 10, [{}, { discount_percent: 0 }]);
    const out = customerCopyLines(lines, "straight", "");
    expect(out[0].unit_price).toBe(
      Math.round(37201.708 * 3 * 0.9 + 54257.7107 * 2),
    );
  });

  it("uses the photo attached to any Kreation line", () => {
    const lines = asQuote(sel(), 0, [{}, { image_url: "https://example.com/x3.jpg", image_source: "manual" }]);
    expect(x3PhotoLine(lines)!.id).toBe("x1");
    expect(customerCopyLines(lines, "parallel", "")[0].image_url).toBe("https://example.com/x3.jpg");
  });

  it("saves and restores the layout and dimensions through the notes column", () => {
    const notes = encodeX3Notes("parallel", "Two walls, 7 ft each");
    expect(decodeX3Notes(notes)).toEqual({ layout: "parallel", dimensions: "Two walls, 7 ft each" });
    expect(encodeX3Notes(null, "  ")).toBeNull();
    expect(decodeX3Notes("Call customer after Diwali")).toEqual({ layout: null, dimensions: "" });
    expect(decodeX3Notes('x3layout:{"layout":"bogus","dimensions":5}')).toEqual({ layout: null, dimensions: "" });
    expect(decodeX3Notes("x3layout:{not json")).toEqual({ layout: null, dimensions: "" });
  });

  it("prints the dimensions in the PDF instead of any code", () => {
    const out = customerCopyLines(asQuote(sel(), 0), "straight", "Wall A 8 ft");
    const doc = buildQuotePdf(
      out.map((l) => ({ ...l, image_url: null, discount_percent: l.discount_percent || 0 })),
      { customerName: "A", billingAddress: "", deliveryAddress: "", quoteNumber: "Q1", quoteDate: "01/01/2027", handlingCharges: 0, contactLine: "" },
      { letterhead: null, images: [null] },
    );
    const text = (doc as unknown as { internal: { pages: string[][] } }).internal.pages.flat().join(" ");
    expect(text).toContain("KREATION X3 STRAIGHT");
    expect(text).toContain("Wall A 8 ft");
    expect(text).not.toContain("30161803SD");
  });

  it("prints the dimensions in the Excel quote instead of any code", async () => {
    const out = customerCopyLines(asQuote(sel(), 0), "u-shape", "Wall A 8 ft\nWall B 6 ft");
    const wb = await buildQuoteWorkbook(
      out.map((l) => ({ ...l, image_url: null, discount_percent: l.discount_percent || 0 })),
      { customerName: "A", billingAddress: "", deliveryAddress: "", quoteNumber: "Q1", quoteDate: "01/01/2027", handlingCharges: 0, contactLine: "" },
    );
    const ws = wb.getWorksheet("Quote")!;
    expect(ws.getCell("D11").value).toBe("KREATION X3 U-SHAPE");
    expect(ws.getCell("D12").value).toBe("Wall A 8 ft\nWall B 6 ft");
    const all: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => all.push(String(c.value))));
    expect(all.join(" ")).not.toContain("30161803SD");
  });
});

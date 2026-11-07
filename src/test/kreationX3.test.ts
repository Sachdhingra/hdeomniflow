import { describe, expect, it } from "vitest";
import {
  X3_ITEMS,
  X3_TABS,
  isX3QuoteLine,
  x3ItemByKey,
  x3LineAmount,
  x3QuoteLines,
  x3Totals,
  x3UnitsTotals,
} from "@/lib/kreationX3";
import { quoteTotals } from "@/lib/productLibrary";
import { buildQuotePdf } from "@/lib/quotePdf";
import { buildQuoteWorkbook } from "@/lib/quoteExcel";
import {
  customerCopyLines,
  decodeX3Notes,
  encodeX3Notes,
  internalCopyLines,
  isX3CustomerLine,
  x3PhotoLine,
  x3UnitNumbers,
  x3UnitsMissingLayout,
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
  it("carries the code, nett price, GST, unit number and the single discount on every line", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const lines = x3QuoteLines([{ [a]: 2 }], 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      product_id: null,
      sku: "30161803SD01067",
      quantity: 2,
      gst_percent: 18,
      discount_percent: 10,
      group_no: 1,
      product_name: "Kreation X3 Main Body 1200W 560D 1900H Alpine White",
    });
    expect(lines[0].unit_price).toBeCloseTo(37201.708, 3);
    expect(isX3QuoteLine({ product_id: null, description: lines[0].description })).toBe(true);
    expect(isX3QuoteLine({ product_id: "p1", description: lines[0].description })).toBe(false);
    expect(isX3QuoteLine({ product_id: null, description: "Some other product" })).toBe(false);
  });

  it("numbers the non-empty units 1, 2, … and skips empty ones", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const b = keyOf("30161803SD01265", "CHEST OF DRAWER");
    const lines = x3QuoteLines([{}, { [a]: 1 }, { [a]: 2, [b]: 1 }], 0);
    expect(lines.map((l) => [l.sku, l.quantity, l.group_no])).toEqual([
      ["30161803SD01067", 1, 1],
      ["30161803SD01067", 2, 2],
      ["30161803SD01265", 1, 2],
    ]);
  });

  it("lands within a rupee per line of the calculator amount on the quotation", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const b = keyOf("30161803SD01265", "CHEST OF DRAWER");
    const sel = { [a]: 3, [b]: 2 };
    const q = quoteTotals(x3QuoteLines([sel], 7.5));
    expect(Math.abs(q.grandTotal - x3Totals(sel, 7.5).amount)).toBeLessThanOrEqual(2);
  });
});

describe("Kreation X3 totals across units", () => {
  const a = () => keyOf("30161803SD01067", "1900H");
  const b = () => keyOf("30161803SD01265", "CHEST OF DRAWER");

  it("takes the one discount off each unit and adds the unit amounts", () => {
    const t = x3UnitsTotals([{ [a()]: 3 }, { [b()]: 2 }], 7.5);
    const one = x3Totals({ [a()]: 3 }, 7.5);
    const two = x3Totals({ [b()]: 2 }, 7.5);
    expect(t.units).toEqual([one, two]);
    expect(t.pieces).toBe(5);
    expect(t.total).toBe(one.total + two.total);
    expect(t.discount).toBe(one.discount + two.discount);
    expect(t.amount).toBe(one.amount + two.amount);
    expect(t.discountPercent).toBe(7.5);
  });

  it("matches the single-unit totals when there is one unit", () => {
    const sel = { [a()]: 3, [b()]: 2 };
    expect(x3UnitsTotals([sel], 7.5)).toMatchObject({ total: 220120, discount: 16509, amount: 203611 });
  });
});

describe("Kreation X3 customer copy", () => {
  const asQuote = (units: Record<string, number>[], disc: number, extra: Partial<QuoteLine>[] = []): QuoteLine[] =>
    x3QuoteLines(units, disc).map((l, i) => ({ ...l, id: `x${i}`, ...(extra[i] || {}) }));
  const u1 = () => ({ [keyOf("30161803SD01067", "1900H")]: 3, [keyOf("30161803SD01265", "CHEST OF DRAWER")]: 2 });
  const u2 = () => ({ [keyOf("30161803SD01068", "1900H")]: 1, [keyOf("30161803SD01067", "1900H")]: 2 });
  const other: QuoteLine = {
    id: "o1", product_id: "p1", variant_id: null, image_url: null, product_name: "Sofa", sku: "SOFA1",
    description: "Sofa", quantity: 1, unit_price: 11800, gst_percent: 18,
  };

  it("collapses the parts into one layout line at the calculator amount, with no codes", () => {
    const lines = asQuote([u1()], 7.5);
    const out = customerCopyLines(lines, { 1: { layout: "l-shape", dimensions: " Wall A 8 ft + Wall B 6 ft " } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      product_name: "Kreation X3 L-Shape",
      details: "Wall A 8 ft + Wall B 6 ft",
      sku: null,
      description: null,
      quantity: 1,
      discount_percent: 0,
    });
    expect(isX3CustomerLine(out[0])).toBe(true);
    expect(out[0].unit_price).toBe(x3Totals(u1(), 7.5).amount);
    expect(quoteTotals(out).grandTotal).toBeCloseTo(x3Totals(u1(), 7.5).amount, 2);
  });

  it("gives each unit its own line, layout, dimensions and photo, and the total adds up", () => {
    const lines = asQuote([u1(), u2()], 5, [{}, {}, {}, { image_url: "https://example.com/u2.jpg", image_source: "manual" }]);
    expect(x3UnitNumbers(lines)).toEqual([1, 2]);
    const out = customerCopyLines(lines, {
      1: { layout: "l-shape", dimensions: "Master bedroom, 8 ft + 6 ft" },
      2: { layout: "straight", dimensions: "Guest room, 7 ft" },
    });
    expect(out.map((l) => [l.product_name, l.details, l.image_url])).toEqual([
      ["Kreation X3 L-Shape", "Master bedroom, 8 ft + 6 ft", null],
      ["Kreation X3 Straight", "Guest room, 7 ft", "https://example.com/u2.jpg"],
    ]);
    const t = x3UnitsTotals([u1(), u2()], 5);
    expect(out.map((l) => l.unit_price)).toEqual(t.units.map((u) => u.amount));
    expect(quoteTotals(out).grandTotal).toBeCloseTo(t.amount, 2);
    expect(JSON.stringify(out)).not.toContain("30161803SD");
  });

  it("keeps the same part in two units as two separate lines", () => {
    const lines = asQuote([u1(), u2()], 0);
    const same = lines.filter((l) => l.sku === "30161803SD01067");
    expect(same.map((l) => [l.group_no, l.quantity])).toEqual([[1, 3], [2, 2]]);
  });

  it("keeps other products, puts each unit where its first part was, and leaves the originals alone", () => {
    const lines = [other, ...asQuote([u1(), u2()], 0)];
    const out = customerCopyLines(lines, { 1: { layout: "u-shape", dimensions: "" }, 2: { layout: "parallel", dimensions: "" } });
    expect(out.map((l) => l.product_name)).toEqual(["Sofa", "Kreation X3 U-Shape", "Kreation X3 Parallel"]);
    expect(out[1].details).toBeNull();
    expect(lines).toHaveLength(1 + 4);
    expect(lines[1].sku).toBe("30161803SD01067");
    expect(customerCopyLines([other], {})).toEqual([other]);
  });

  it("treats lines saved before units existed as unit 1 and finds units without a layout", () => {
    const old = asQuote([u1()], 0).map(({ group_no: _g, ...l }) => l as QuoteLine);
    expect(x3UnitNumbers(old)).toEqual([1]);
    expect(x3UnitsMissingLayout(old, {})).toEqual([1]);
    expect(x3UnitsMissingLayout(old, { 1: { layout: "straight", dimensions: "" } })).toEqual([]);
    const two = asQuote([u1(), u2()], 0);
    expect(x3UnitsMissingLayout(two, { 2: { layout: "straight", dimensions: "" } })).toEqual([1]);
  });

  it("labels the parts with their unit on the internal copy only when there is more than one unit", () => {
    expect(internalCopyLines(asQuote([u1()], 0))[0].details).toBeUndefined();
    const two = internalCopyLines(asQuote([u1(), u2()], 0));
    expect(two[0].details).toBe("30161803SD01067 · Unit 1");
    expect(two[two.length - 1].details).toMatch(/· Unit 2$/);
  });

  it("falls back to the discounted sum when parts of a unit carry different discounts", () => {
    const lines = asQuote([u1()], 10, [{}, { discount_percent: 0 }]);
    const out = customerCopyLines(lines, { 1: { layout: "straight", dimensions: "" } });
    expect(out[0].unit_price).toBe(Math.round(37201.708 * 3 * 0.9 + 54257.7107 * 2));
  });

  it("uses the photo attached to any part of the unit", () => {
    const lines = asQuote([u1()], 0, [{}, { image_url: "https://example.com/x3.jpg", image_source: "manual" }]);
    expect(x3PhotoLine(lines, 1)!.id).toBe("x1");
    expect(customerCopyLines(lines, { 1: { layout: "parallel", dimensions: "" } })[0].image_url).toBe("https://example.com/x3.jpg");
  });

  it("saves and restores layouts and dimensions per unit through the notes column", () => {
    const notes = encodeX3Notes({ 1: { layout: "parallel", dimensions: " Two walls, 7 ft each " }, 2: { layout: "straight", dimensions: "" } });
    expect(decodeX3Notes(notes)).toEqual({
      1: { layout: "parallel", dimensions: "Two walls, 7 ft each" },
      2: { layout: "straight", dimensions: "" },
    });
    expect(encodeX3Notes({ 1: { layout: null, dimensions: "  " } })).toBeNull();
    expect(decodeX3Notes("Call customer after Diwali")).toEqual({});
    expect(decodeX3Notes('x3layout:{"units":{"1":{"layout":"bogus","dimensions":5},"x":{"layout":"straight"}}}')).toEqual({
      1: { layout: null, dimensions: "" },
    });
    expect(decodeX3Notes("x3layout:{not json")).toEqual({});
  });

  it("still reads the single layout saved by the first version as unit 1", () => {
    expect(decodeX3Notes('x3layout:{"layout":"l-shape","dimensions":"8 ft"}')).toEqual({
      1: { layout: "l-shape", dimensions: "8 ft" },
    });
  });

  const meta = { customerName: "A", billingAddress: "", deliveryAddress: "", quoteNumber: "Q1", quoteDate: "01/01/2027", handlingCharges: 0, contactLine: "" };
  const forExport = (out: QuoteLine[]) => out.map((l) => ({ ...l, image_url: null, discount_percent: l.discount_percent || 0 }));
  const twoUnits = () =>
    customerCopyLines(asQuote([u1(), u2()], 0), {
      1: { layout: "straight", dimensions: "Wall A 8 ft" },
      2: { layout: "u-shape", dimensions: "Wall B 6 ft" },
    });

  it("prints every unit's layout and dimensions in the PDF instead of any code", () => {
    const doc = buildQuotePdf(forExport(twoUnits()), meta, { letterhead: null, images: [null, null] });
    const text = (doc as unknown as { internal: { pages: string[][] } }).internal.pages.flat().join(" ");
    expect(text).toContain("KREATION X3 STRAIGHT");
    expect(text).toContain("KREATION X3 U-SHAPE");
    expect(text).toContain("Wall A 8 ft");
    expect(text).toContain("Wall B 6 ft");
    expect(text).not.toContain("30161803SD");
  });

  it("prints every unit's layout and dimensions in the Excel quote instead of any code", async () => {
    const wb = await buildQuoteWorkbook(forExport(twoUnits()), meta);
    const ws = wb.getWorksheet("Quote")!;
    expect(ws.getCell("D11").value).toBe("KREATION X3 STRAIGHT");
    expect(ws.getCell("D12").value).toBe("Wall A 8 ft");
    expect(ws.getCell("D19").value).toBe("KREATION X3 U-SHAPE");
    expect(ws.getCell("D20").value).toBe("Wall B 6 ft");
    const all: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => all.push(String(c.value))));
    expect(all.join(" ")).not.toContain("30161803SD");
  });
});

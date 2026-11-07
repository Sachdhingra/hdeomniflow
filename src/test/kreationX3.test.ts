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
    expect(isX3QuoteLine({ product_id: null, sku: lines[0].sku })).toBe(true);
    expect(isX3QuoteLine({ product_id: "p1", sku: lines[0].sku })).toBe(false);
  });

  it("lands within a rupee per line of the calculator amount on the quotation", () => {
    const a = keyOf("30161803SD01067", "1900H");
    const b = keyOf("30161803SD01265", "CHEST OF DRAWER");
    const sel = { [a]: 3, [b]: 2 };
    const q = quoteTotals(x3QuoteLines(sel, 7.5));
    expect(Math.abs(q.grandTotal - x3Totals(sel, 7.5).amount)).toBeLessThanOrEqual(2);
  });
});

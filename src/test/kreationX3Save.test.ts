import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteLine } from "@/contexts/QuoteContext";

const inserted: { table: string; rows: Record<string, unknown> | Record<string, unknown>[] }[] = [];

vi.mock("@/lib/productLibrary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/productLibrary")>("@/lib/productLibrary");
  const chain = (table: string) => ({
    insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      inserted.push({ table, rows });
      return { select: () => ({ single: async () => ({ data: { id: "q1", quote_number: "HDE/1" }, error: null }) }) };
    },
  });
  return { ...actual, plDb: { from: (t: string) => chain(t) } };
});

import { saveQuote, EMPTY_META } from "@/lib/savedQuotes";

const line = (over: Partial<QuoteLine>): QuoteLine => ({
  id: crypto.randomUUID(), product_id: null, variant_id: null, image_url: null, product_name: "x", sku: "A",
  description: "KreX3A", quantity: 1, unit_price: 1000, gst_percent: 18, discount_percent: 0, ...over,
});
const itemRows = () => inserted.find((i) => i.table === "quote_items")!.rows as Record<string, unknown>[];

describe("saving Kreation quotes", () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it("writes unit numbers only when the quote has more than one unit, so older databases keep working", async () => {
    await saveQuote([line({ group_no: 1 }), line({ group_no: 1, sku: "B" })], EMPTY_META);
    expect(itemRows().every((r) => !("group_no" in r))).toBe(true);
  });

  it("writes every line's unit number on a multi-unit quote", async () => {
    await saveQuote([line({ group_no: 1 }), line({ group_no: 2 }), line({ product_id: "p1", description: "Sofa" })], EMPTY_META);
    expect(itemRows().map((r) => r.group_no)).toEqual([1, 2, undefined]);
  });

  it("saves the layouts and dimensions of each unit in the notes column", async () => {
    await saveQuote([line({ group_no: 1 })], {
      ...EMPTY_META,
      x3Units: { 1: { layout: "l-shape", dimensions: "8 ft" }, 2: { layout: "straight", dimensions: "7 ft" } },
    });
    const header = inserted.find((i) => i.table === "quotes")!.rows as Record<string, unknown>;
    expect(header.notes).toContain('"l-shape"');
    expect(header.notes).toContain('"2"');
  });

  it("leaves notes out of the save when no layout is set", async () => {
    await saveQuote([line({})], EMPTY_META);
    expect("notes" in (inserted.find((i) => i.table === "quotes")!.rows as Record<string, unknown>)).toBe(false);
  });
});

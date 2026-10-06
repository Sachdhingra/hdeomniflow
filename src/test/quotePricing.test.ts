import { describe, expect, it } from "vitest";
import { lineTotal, priceBreakdown, quoteTotals } from "@/lib/productLibrary";
import { buildCatalogIndex, findWebsiteProduct, websiteImageOf } from "@/lib/websiteCatalog";

describe("quote pricing with GST-inclusive Omniflow prices", () => {
  it("works back to the basic price and lands on the same inclusive price", () => {
    const b = priceBreakdown(11800, 18);
    expect(b.unitBasic).toBeCloseTo(10000, 6);
    expect(b.unitGst).toBeCloseTo(1800, 6);
    expect(b.unitInclusive).toBeCloseTo(11800, 6);
  });

  it("applies the discount to the basic price, then adds GST", () => {
    const b = priceBreakdown(11800, 18, 10);
    expect(b.specialBasic).toBeCloseTo(9000, 6);
    expect(b.unitGst).toBeCloseTo(1620, 6);
    expect(b.unitInclusive).toBeCloseTo(10620, 6);
  });

  it("does not add GST on top of an inclusive price", () => {
    expect(lineTotal(2, 13831, 18)).toBe(27662);
    expect(lineTotal(1, 13831, 18, 5)).toBe(13139.45);
  });

  it("totals taxable value + GST = grand total", () => {
    const t = quoteTotals([
      { quantity: 2, unit_price: 11800, gst_percent: 18 },
      { quantity: 1, unit_price: 3710, gst_percent: 18, discount_percent: 10 },
    ]);
    expect(t.grandTotal).toBe(23600 + 3339);
    expect(t.subtotal + t.gstTotal).toBeCloseTo(t.grandTotal, 2);
  });
});

describe("website catalogue matching", () => {
  const index = buildCatalogIndex([
    {
      id: "56101508sd08429",
      sku: "56101508SD08429",
      name: "Kreative Single Bed Foam Mattress",
      image: "https://hdefurniture.netlify.app/assets/img/products/56101508sd08429.jpg",
      remoteImage: "https://interio.com/media/a.jpg",
    },
    {
      id: "slim2dr2swinbr",
      sku: "SLIM2DR2SWINBR",
      name: "Slimline 2-Door Steel Almirah Winter Berry",
      image: null,
      remoteImage: "https://interio.com/media/b.jpg",
    },
  ]);

  it("matches the Interio line code case-insensitively", () => {
    const hit = findWebsiteProduct(index, { codes: ["ZentiaSku", "56101508sd08429"] });
    expect(websiteImageOf(hit)).toContain("hdefurniture.netlify.app");
  });

  it("falls back to an exact product name and to the remote image", () => {
    const hit = findWebsiteProduct(index, {
      codes: [null],
      name: "slimline 2 door steel almirah - winter berry",
    });
    expect(websiteImageOf(hit)).toBe("https://interio.com/media/b.jpg");
  });

  it("returns null for products the website does not list", () => {
    expect(findWebsiteProduct(index, { codes: ["NOPE"], name: "Custom sofa" })).toBeNull();
  });
});

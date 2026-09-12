import { describe, it, expect } from "vitest";
import {
  aggregateMovement,
  buildMonthKeys,
  classifyAction,
  isSafesCategory,
  monthKey,
  toCsv,
  windowStart,
  type AuditRow,
  type ProductRef,
} from "@/lib/safesMovement";

const NOW = new Date(2026, 8, 12); // 12 Sep 2026
const MONTHS = buildMonthKeys(3, NOW); // 2026-07, 2026-08, 2026-09

const products: ProductRef[] = [
  { id: "p1", product_name: "Godrej Defender 40L", sku: "SAFE-DEF-40", net_price: 25000, category_name: "Safes" },
  { id: "p2", product_name: "Godrej Matrix 3016", sku: "SAFE-MTX-3016", net_price: 40000, category_name: "Safes" },
  { id: "p3", product_name: "Godrej Taurus 60L", sku: "SAFE-TAU-60", net_price: 18000, category_name: "Safes" },
];

function sale(product_id: string, iso: string, units = 1): AuditRow {
  return { product_id, action: "sale_deduction", quantity_change: -units, created_at: iso };
}

describe("safesMovement window helpers", () => {
  it("builds the last three month keys, oldest first", () => {
    expect(MONTHS).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("rolls the window back across a year boundary", () => {
    expect(buildMonthKeys(3, new Date(2026, 0, 15))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("starts the window at midnight on the 1st of the earliest month", () => {
    const start = windowStart(3, NOW);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6); // July
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });

  it("derives the month key from a timestamp", () => {
    expect(monthKey("2026-08-03T11:20:00Z")).toBe("2026-08");
  });
});

describe("classifyAction", () => {
  it("buckets the audit actions the inventory triggers write", () => {
    expect(classifyAction("sale_deduction")).toBe("sold");
    expect(classifyAction("admin_override_sale")).toBe("sold");
    expect(classifyAction("stock_received")).toBe("received");
    expect(classifyAction("warehouse_receipt")).toBe("received");
    expect(classifyAction("sale_reversal_on_delete")).toBe("returned");
    expect(classifyAction("replacement_display_receipt")).toBe("transfer");
    expect(classifyAction("stock_count")).toBe("adjustment");
  });

  it("treats an unknown action as an adjustment so it never inflates sales", () => {
    expect(classifyAction("some_future_action")).toBe("adjustment");
  });
});

describe("isSafesCategory", () => {
  it("matches the safes naming variants, coded ones included", () => {
    expect(isSafesCategory("SAFES1")).toBe(true);
    expect(isSafesCategory("Safes")).toBe(true);
    expect(isSafesCategory("SAFE - Home")).toBe(true);
    expect(isSafesCategory("Vaults")).toBe(true);
    expect(isSafesCategory("Sofa")).toBe(false);
    expect(isSafesCategory(null)).toBe(false);
  });

  it("does not sweep in storage-locker furniture", () => {
    expect(isSafesCategory("Lockers")).toBe(false);
    expect(isSafesCategory("UPMDSDINCHR1")).toBe(false);
  });
});

describe("aggregateMovement", () => {
  const audit: AuditRow[] = [
    // p1: 2 → 3 → 5 net sold, rising
    sale("p1", "2026-07-04T10:00:00Z", 2),
    sale("p1", "2026-08-11T10:00:00Z", 3),
    sale("p1", "2026-09-02T10:00:00Z", 6),
    { product_id: "p1", action: "sale_reversal", quantity_change: 1, created_at: "2026-09-05T10:00:00Z" },
    { product_id: "p1", action: "stock_received", quantity_change: 10, created_at: "2026-08-01T10:00:00Z" },
    // p2: 6 → 4 → 2, falling
    sale("p2", "2026-07-09T10:00:00Z", 6),
    sale("p2", "2026-08-09T10:00:00Z", 4),
    sale("p2", "2026-09-09T10:00:00Z", 2),
    // noise that must not count as trade
    { product_id: "p2", action: "replacement_display_receipt", quantity_change: 3, created_at: "2026-08-20T10:00:00Z" },
    { product_id: "p2", action: "stock_count", quantity_change: -2, created_at: "2026-08-21T10:00:00Z" },
    // outside the window
    sale("p1", "2026-05-01T10:00:00Z", 99),
    // unknown product
    sale("ghost", "2026-08-01T10:00:00Z", 50),
  ];

  const summary = aggregateMovement(audit, products, MONTHS, {
    stockByProduct: { p1: 4, p2: 7, p3: 2 },
  });

  it("counts sales per model per month, net of reversals", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(MONTHS.map(k => p1.months[k].netSold)).toEqual([2, 3, 5]);
    expect(p1.totalSold).toBe(11);
    expect(p1.totalReturned).toBe(1);
    expect(p1.netSold).toBe(10);
  });

  it("ignores rows outside the window and rows for unknown products", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.netSold).toBe(10); // the 99-unit May sale is excluded
    expect(summary.rows.some(r => r.productId === "ghost")).toBe(false);
    expect(summary.totals.netSold).toBe(22); // 10 (p1) + 12 (p2)
  });

  it("excludes internal transfers and stock corrections from movement", () => {
    const p2 = summary.rows.find(r => r.productId === "p2")!;
    expect(p2.totalReceived).toBe(0);
    expect(p2.netSold).toBe(12);
  });

  it("tracks receipts and net stock movement", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.totalReceived).toBe(10);
    expect(p1.netMovement).toBe(0); // received 10, sold 10 net
  });

  it("flags direction from the latest month against the previous one", () => {
    expect(summary.rows.find(r => r.productId === "p1")!.direction).toBe("up");
    expect(summary.rows.find(r => r.productId === "p2")!.direction).toBe("down");
    expect(summary.rows.find(r => r.productId === "p1")!.trendPct).toBe(67);
    expect(summary.rows.find(r => r.productId === "p2")!.windowChangePct).toBe(-67);
  });

  it("ranks models by net units sold", () => {
    expect(summary.rows.map(r => r.productId)).toEqual(["p2", "p1", "p3"]);
    expect(summary.topModels).toEqual(["Godrej Matrix 3016", "Godrej Defender 40L"]);
  });

  it("keeps idle models visible with zero movement", () => {
    const p3 = summary.rows.find(r => r.productId === "p3")!;
    expect(p3.netSold).toBe(0);
    expect(p3.direction).toBe("flat");
    expect(p3.stockOnHand).toBe(2);
    expect(summary.totals.modelsMoved).toBe(2);
    expect(summary.totals.modelsIdle).toBe(1);
  });

  it("values net sales at the product's net price", () => {
    const p2 = summary.rows.find(r => r.productId === "p2")!;
    expect(p2.value).toBe(12 * 40000);
    expect(summary.totals.value).toBe(10 * 25000 + 12 * 40000);
  });

  it("builds one chart point per month carrying the top models", () => {
    expect(summary.chartData).toHaveLength(3);
    expect(summary.chartData[2]["Godrej Defender 40L"]).toBe(5);
    expect(summary.chartData[0]["Godrej Matrix 3016"]).toBe(6);
  });

  it("exports a CSV with a header and one line per model", () => {
    const lines = toCsv(summary).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Jul 26 sold");
    expect(lines[1]).toContain("Godrej Matrix 3016");
  });

  it("reports a flat trend when nothing moved at all", () => {
    const empty = aggregateMovement([], products, MONTHS);
    expect(empty.totals.netSold).toBe(0);
    expect(empty.topModels).toEqual([]);
    expect(empty.rows.every(r => r.direction === "flat" && r.trendPct === 0)).toBe(true);
  });
});

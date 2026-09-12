import { describe, it, expect } from "vitest";
import {
  aggregateMovement,
  buildMonthKeys,
  isSafesCategory,
  monthKey,
  toCsv,
  windowStart,
  type AuditRow,
  type OrderRow,
  type ProductRef,
} from "@/lib/safesMovement";

const NOW = new Date(2026, 8, 12); // 12 Sep 2026
const MONTHS = buildMonthKeys(3, NOW); // 2026-07, 2026-08, 2026-09

const products: ProductRef[] = [
  { id: "p1", product_name: "Godrej Defender 40L", sku: "SAFE-DEF-40", net_price: 25000, category_name: "SAFES1" },
  { id: "p2", product_name: "Godrej Matrix 3016", sku: "SAFE-MTX-3016", net_price: 40000, category_name: "SAFES1" },
  { id: "p3", product_name: "Godrej Taurus 60L", sku: "SAFE-TAU-60", net_price: 18000, category_name: "SAFES1" },
];

function sale(product_id: string, created_at: string, qty_sold: number | null = 1, status = "completed"): OrderRow {
  return { product_id, order_type: "showroom", status, qty_sold, created_at };
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
  const orders: OrderRow[] = [
    // p1: 2 → 3 → 5 sold, rising
    sale("p1", "2026-07-04T10:00:00Z", 2),
    sale("p1", "2026-08-11T10:00:00Z", 3),
    sale("p1", "2026-09-02T10:00:00Z", 5),
    // cancelled and rejected orders never count as sales
    sale("p1", "2026-09-05T10:00:00Z", 4, "cancelled"),
    sale("p1", "2026-09-06T10:00:00Z", 1, "rejected"),
    // p2: 6 → 4 → 2, falling — sold through the warehouse
    { product_id: "p2", order_type: "warehouse", status: "completed", qty_sold: 6, created_at: "2026-07-09T10:00:00Z" },
    { product_id: "p2", order_type: "warehouse", status: "approved", qty_sold: 4, created_at: "2026-08-09T10:00:00Z" },
    { product_id: "p2", order_type: "warehouse", status: "in_progress", qty_sold: 2, created_at: "2026-09-09T10:00:00Z" },
    // a company order: stock in, dated on completion, never a sale
    {
      product_id: "p1", order_type: "company", status: "completed", qty_sold: 8,
      created_at: "2026-07-20T10:00:00Z", completed_at: "2026-08-04T10:00:00Z",
    },
    // an open company order has not landed yet
    { product_id: "p3", order_type: "company", status: "pending_approval", qty_sold: 5, created_at: "2026-08-02T10:00:00Z" },
    // outside the window
    sale("p1", "2026-05-01T10:00:00Z", 99),
    // unknown product
    sale("ghost", "2026-08-01T10:00:00Z", 50),
  ];

  const audit: AuditRow[] = [
    // manual Receive Stock — the only audit path with no order row
    { product_id: "p2", action: "stock_received", quantity_change: 6, created_at: "2026-08-15T10:00:00Z" },
    // these all have order rows behind them and must not be double counted
    { product_id: "p1", action: "warehouse_receipt", quantity_change: 8, created_at: "2026-08-04T10:00:00Z" },
    { product_id: "p1", action: "sale_deduction", quantity_change: -3, created_at: "2026-08-11T10:00:00Z" },
    { product_id: "p2", action: "replacement_display_receipt", quantity_change: 3, created_at: "2026-08-20T10:00:00Z" },
  ];

  const summary = aggregateMovement({ orders, audit }, products, MONTHS, {
    stockByProduct: { p1: 4, p2: 7, p3: 2 },
  });

  it("counts units sold per model per month from the order book", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(MONTHS.map(k => p1.months[k].sold)).toEqual([2, 3, 5]);
    expect(p1.totalSold).toBe(10);
  });

  it("keeps cancelled and rejected orders out of the sold figure", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.totalCancelled).toBe(5);
    expect(p1.months["2026-09"].sold).toBe(5);
  });

  it("counts a sale on every live status, not just completed", () => {
    const p2 = summary.rows.find(r => r.productId === "p2")!;
    expect(MONTHS.map(k => p2.months[k].sold)).toEqual([6, 4, 2]);
  });

  it("treats a missing qty_sold as one unit", () => {
    const one = aggregateMovement({ orders: [sale("p3", "2026-08-01T10:00:00Z", null)] }, products, MONTHS);
    expect(one.rows.find(r => r.productId === "p3")!.totalSold).toBe(1);
  });

  it("ignores rows outside the window and rows for unknown products", () => {
    expect(summary.rows.some(r => r.productId === "ghost")).toBe(false);
    expect(summary.totals.sold).toBe(22); // 10 (p1) + 12 (p2)
  });

  it("dates a company receipt on completion and ignores open ones", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.months["2026-07"].received).toBe(0);
    expect(p1.months["2026-08"].received).toBe(8);
    expect(summary.rows.find(r => r.productId === "p3")!.totalReceived).toBe(0);
  });

  it("adds manual stock receipts without double counting order-backed ones", () => {
    const p2 = summary.rows.find(r => r.productId === "p2")!;
    expect(p2.totalReceived).toBe(6); // the 'stock_received' row only
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.totalReceived).toBe(8); // the company order, not the audit echo of it
  });

  it("tracks net stock movement across the window", () => {
    const p1 = summary.rows.find(r => r.productId === "p1")!;
    expect(p1.netMovement).toBe(-2); // received 8, sold 10
  });

  it("flags direction from the latest month against the previous one", () => {
    expect(summary.rows.find(r => r.productId === "p1")!.direction).toBe("up");
    expect(summary.rows.find(r => r.productId === "p2")!.direction).toBe("down");
    expect(summary.rows.find(r => r.productId === "p1")!.trendPct).toBe(67);
    expect(summary.rows.find(r => r.productId === "p2")!.windowChangePct).toBe(-67);
  });

  it("ranks models by units sold", () => {
    expect(summary.rows.map(r => r.productId)).toEqual(["p2", "p1", "p3"]);
    expect(summary.topModels).toEqual(["Godrej Matrix 3016", "Godrej Defender 40L"]);
  });

  it("keeps idle models visible with zero movement", () => {
    const p3 = summary.rows.find(r => r.productId === "p3")!;
    expect(p3.totalSold).toBe(0);
    expect(p3.direction).toBe("flat");
    expect(p3.stockOnHand).toBe(2);
    expect(summary.totals.modelsMoved).toBe(2);
    expect(summary.totals.modelsIdle).toBe(1);
  });

  it("values sales at the product's net price", () => {
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
    const empty = aggregateMovement({ orders: [] }, products, MONTHS);
    expect(empty.totals.sold).toBe(0);
    expect(empty.topModels).toEqual([]);
    expect(empty.rows.every(r => r.direction === "flat" && r.trendPct === 0)).toBe(true);
  });
});

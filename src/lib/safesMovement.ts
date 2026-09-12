// Model-wise movement trend for a product category (defaults to Safes).
//
// Units sold come from hde_orders, which is the book of record for a sale.
// The inventory_audit_log is deliberately NOT used for sales: a deduction is
// only written when the order carries a location_id (see
// handle_hde_order_sale_deduction, and the legacy backfill in
// 20260717120000), so location-less sale orders are missing from it entirely.
//
// Receipts come from two non-overlapping paths: company orders completed
// (which write 'warehouse_receipt' themselves) and the manual Receive Stock
// RPC (which writes 'stock_received' with no order row). Counting the order
// rows for the first and the audit rows for the second avoids double counting.
//
// Kept pure so the numbers can be unit-tested without a database.

export const MOVEMENT_MONTHS = 3;

/** Order types that mean a unit left the business to a customer. */
export const SALE_ORDER_TYPES = ["warehouse", "showroom"];
/** Order type that means stock is being pulled in from the company. */
export const RECEIPT_ORDER_TYPE = "company";
/** Statuses that void an order — the unit never actually went out. */
export const VOID_STATUSES = ["rejected", "cancelled"];
/** The one audit action that has no order row behind it. */
export const MANUAL_RECEIPT_ACTION = "stock_received";

/**
 * Category names that mean "safes" — matches the coded names the catalogue
 * uses (SAFES1, SAFES2 …) as well as plain ones. Deliberately narrow: "locker"
 * is excluded because storage-locker furniture is not a safe. Any other
 * category can still be picked by hand on the report.
 */
export function isSafesCategory(name?: string | null): boolean {
  if (!name) return false;
  return /safe|vault/i.test(name);
}

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The last `months` month keys, oldest first, ending with the current month. */
export function buildMonthKeys(months = MOVEMENT_MONTHS, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** Midnight on the 1st of the earliest month in the window. */
export function windowStart(months = MOVEMENT_MONTHS, now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
}

export function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

export interface OrderRow {
  product_id: string;
  order_type: string;
  status: string;
  qty_sold: number | null;
  created_at: string;
  completed_at?: string | null;
}

export interface AuditRow {
  product_id: string;
  action: string;
  quantity_change: number;
  created_at: string;
}

export interface ProductRef {
  id: string;
  product_name: string;
  sku: string;
  net_price?: number | null;
  category_name?: string | null;
}

export interface MonthCell {
  /** Units that actually went out to customers. */
  sold: number;
  /** Units on orders that were later rejected or cancelled. Not sold. */
  cancelled: number;
  /** Units taken into stock. */
  received: number;
}

export interface ModelMovementRow {
  productId: string;
  model: string;
  sku: string;
  category: string | null;
  months: Record<string, MonthCell>;
  totalSold: number;
  totalCancelled: number;
  totalReceived: number;
  /** received minus sold — stock built up (+) or drawn down (−) in the window. */
  netMovement: number;
  stockOnHand: number;
  value: number;
  /** Last month vs the month before it, in %. 0 when there is no prior base. */
  trendPct: number;
  /** Last month of the window vs the first, in %. */
  windowChangePct: number;
  direction: "up" | "down" | "flat";
}

export interface MovementTotals {
  months: Record<string, MonthCell>;
  sold: number;
  cancelled: number;
  received: number;
  netMovement: number;
  value: number;
  modelsMoved: number;
  modelsIdle: number;
}

export interface MovementSummary {
  monthKeys: string[];
  rows: ModelMovementRow[];
  totals: MovementTotals;
  chartData: Array<Record<string, string | number>>;
  topModels: string[];
}

function emptyCell(): MonthCell {
  return { sold: 0, cancelled: 0, received: 0 };
}

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100;
  return Math.round(((to - from) / from) * 100);
}

/** Anything under this swing reads as flat rather than a real move. */
const FLAT_BAND = 5;

/** An order row always moves at least one unit, even with qty_sold unset. */
function orderUnits(order: OrderRow): number {
  return Math.max(1, order.qty_sold ?? 1);
}

export interface MovementInput {
  orders: OrderRow[];
  /** Audit rows; only manual 'stock_received' entries are read. */
  audit?: AuditRow[];
}

export interface AggregateOptions {
  /** How many models to plot on the trend chart. */
  topN?: number;
  /** product_id → units currently in stock across all locations. */
  stockByProduct?: Record<string, number>;
}

/**
 * Fold orders and receipts into one row per model over the given month window.
 * Rows outside the window, or for products not in `products`, are ignored.
 */
export function aggregateMovement(
  input: MovementInput,
  products: ProductRef[],
  monthKeys: string[],
  options: AggregateOptions = {},
): MovementSummary {
  const { topN = 6, stockByProduct = {} } = options;
  const { orders, audit = [] } = input;
  const productById = new Map(products.map(p => [p.id, p]));
  const inWindow = new Set(monthKeys);

  const byProduct = new Map<string, ModelMovementRow>();
  const blankMonths = () => Object.fromEntries(monthKeys.map(k => [k, emptyCell()])) as Record<string, MonthCell>;

  const rowFor = (p: ProductRef): ModelMovementRow => {
    let row = byProduct.get(p.id);
    if (!row) {
      row = {
        productId: p.id,
        model: p.product_name || p.sku || "Unknown model",
        sku: p.sku || "",
        category: p.category_name ?? null,
        months: blankMonths(),
        totalSold: 0,
        totalCancelled: 0,
        totalReceived: 0,
        netMovement: 0,
        stockOnHand: stockByProduct[p.id] ?? 0,
        value: 0,
        trendPct: 0,
        windowChangePct: 0,
        direction: "flat",
      };
      byProduct.set(p.id, row);
    }
    return row;
  };

  // Seed every catalogue model so idle ones still surface as zero-movement.
  products.forEach(rowFor);

  /** Returns the month cell to write into, or null when out of scope. */
  const cellAt = (productId: string, iso: string): MonthCell | null => {
    const product = productById.get(productId);
    if (!product) return null;
    const key = monthKey(iso);
    if (!inWindow.has(key)) return null;
    return rowFor(product).months[key];
  };

  for (const order of orders) {
    const units = orderUnits(order);

    if (SALE_ORDER_TYPES.includes(order.order_type)) {
      // A sale is dated when it was raised, not when it was fulfilled.
      const cell = cellAt(order.product_id, order.created_at);
      if (!cell) continue;
      if (VOID_STATUSES.includes(order.status)) cell.cancelled += units;
      else cell.sold += units;
      continue;
    }

    if (order.order_type === RECEIPT_ORDER_TYPE && order.status === "completed") {
      // Stock lands when the company order is completed.
      const cell = cellAt(order.product_id, order.completed_at || order.created_at);
      if (cell) cell.received += units;
    }
  }

  for (const entry of audit) {
    if (entry.action !== MANUAL_RECEIPT_ACTION) continue;
    const units = Math.abs(entry.quantity_change ?? 0);
    if (units === 0) continue;
    const cell = cellAt(entry.product_id, entry.created_at);
    if (cell) cell.received += units;
  }

  const rows = [...byProduct.values()];
  for (const row of rows) {
    for (const key of monthKeys) {
      const cell = row.months[key];
      row.totalSold += cell.sold;
      row.totalCancelled += cell.cancelled;
      row.totalReceived += cell.received;
    }
    row.netMovement = row.totalReceived - row.totalSold;

    const price = productById.get(row.productId)?.net_price ?? 0;
    row.value = row.totalSold * (price || 0);

    const series = monthKeys.map(k => row.months[k].sold);
    const last = series[series.length - 1] ?? 0;
    const prev = series[series.length - 2] ?? 0;
    row.trendPct = pctChange(prev, last);
    row.windowChangePct = pctChange(series[0] ?? 0, last);
    row.direction = row.trendPct > FLAT_BAND ? "up" : row.trendPct < -FLAT_BAND ? "down" : "flat";
  }

  rows.sort((a, b) =>
    b.totalSold - a.totalSold ||
    b.totalReceived - a.totalReceived ||
    a.model.localeCompare(b.model));

  const totals: MovementTotals = {
    months: blankMonths(),
    sold: 0,
    cancelled: 0,
    received: 0,
    netMovement: 0,
    value: 0,
    modelsMoved: 0,
    modelsIdle: 0,
  };

  for (const row of rows) {
    for (const key of monthKeys) {
      const from = row.months[key];
      const into = totals.months[key];
      into.sold += from.sold;
      into.cancelled += from.cancelled;
      into.received += from.received;
    }
    totals.sold += row.totalSold;
    totals.cancelled += row.totalCancelled;
    totals.received += row.totalReceived;
    totals.value += row.value;
    if (row.totalSold > 0 || row.totalReceived > 0) totals.modelsMoved += 1;
    else totals.modelsIdle += 1;
  }
  totals.netMovement = totals.received - totals.sold;

  const topModels = rows.filter(r => r.totalSold > 0).slice(0, topN).map(r => r.model);
  const chartData = monthKeys.map(key => {
    const point: Record<string, string | number> = { month: shortMonth(key), key };
    for (const name of topModels) {
      const row = rows.find(r => r.model === name);
      point[name] = row ? row.months[key].sold : 0;
    }
    return point;
  });

  return { monthKeys, rows, totals, chartData, topModels };
}

/** Flat CSV of the trend table, one line per model. */
export function toCsv(summary: MovementSummary): string {
  const { monthKeys, rows } = summary;
  const header = [
    "Model", "SKU", "Category",
    ...monthKeys.map(k => `${shortMonth(k)} sold`),
    "Total sold", "Cancelled", "Received", "Net movement", "Stock on hand", "MoM %",
  ].join(",");

  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = rows.map(r => [
    r.model, r.sku, r.category ?? "",
    ...monthKeys.map(k => r.months[k].sold),
    r.totalSold, r.totalCancelled, r.totalReceived, r.netMovement, r.stockOnHand, r.trendPct,
  ].map(escape).join(","));

  return [header, ...lines].join("\n");
}

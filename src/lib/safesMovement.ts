// Model-wise movement trend for a product category (defaults to Safes).
//
// Every stock movement in the system lands in inventory_audit_log with a signed
// quantity_change and an action string (see the hde_apply_inventory_delta
// helper). This module turns those raw rows into a month-by-month, model-wise
// trend — kept pure so the numbers can be unit-tested without a database.

export const MOVEMENT_MONTHS = 3;

export type MovementKind = "sold" | "received" | "returned" | "transfer" | "adjustment";

/** Units leaving stock to a customer. */
const SOLD_ACTIONS = new Set(["sale_deduction", "admin_override_sale", "stock_out_order"]);
/** Units entering stock from the company / supplier. */
const RECEIVED_ACTIONS = new Set(["stock_received", "warehouse_receipt", "order_company_receipt"]);
/** Units put back after a cancelled, rejected or deleted sale. */
const RETURNED_ACTIONS = new Set(["sale_reversal", "sale_reversal_on_delete", "reversal"]);
/** Internal warehouse → showroom shuffles. Net zero, never counted as movement. */
const TRANSFER_ACTIONS = new Set(["replacement_warehouse_deduction", "replacement_display_receipt"]);
/** Corrections and imports — real, but not trade. */
const ADJUSTMENT_ACTIONS = new Set(["manual_adjustment", "stock_count", "tally_import", "pending_resolved"]);

/**
 * Bucket an audit action. Unknown actions fall back to "adjustment" so a new
 * action type never silently inflates the sold/received figures.
 */
export function classifyAction(action: string): MovementKind {
  const a = (action || "").toLowerCase();
  if (SOLD_ACTIONS.has(a)) return "sold";
  if (RECEIVED_ACTIONS.has(a)) return "received";
  if (RETURNED_ACTIONS.has(a)) return "returned";
  if (TRANSFER_ACTIONS.has(a)) return "transfer";
  if (ADJUSTMENT_ACTIONS.has(a)) return "adjustment";
  return "adjustment";
}

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

export interface AuditRow {
  product_id: string;
  action: string;
  quantity_change: number;
  created_at: string;
  location_id?: string | null;
}

export interface ProductRef {
  id: string;
  product_name: string;
  sku: string;
  net_price?: number | null;
  category_name?: string | null;
}

export interface MonthCell {
  sold: number;
  returned: number;
  received: number;
  /** sold minus returned — what actually left the business that month. */
  netSold: number;
}

export interface ModelMovementRow {
  productId: string;
  model: string;
  sku: string;
  category: string | null;
  months: Record<string, MonthCell>;
  totalSold: number;
  totalReturned: number;
  netSold: number;
  totalReceived: number;
  /** received minus netSold — stock built up (+) or drawn down (−) in the window. */
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
  returned: number;
  netSold: number;
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
  return { sold: 0, returned: 0, received: 0, netSold: 0 };
}

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100;
  return Math.round(((to - from) / from) * 100);
}

/** Anything under this swing reads as flat rather than a real move. */
const FLAT_BAND = 5;

export interface AggregateOptions {
  /** How many models to plot on the trend chart. */
  topN?: number;
  /** product_id → units currently in stock across all locations. */
  stockByProduct?: Record<string, number>;
}

/**
 * Fold audit rows into one row per model over the given month window.
 * Rows outside the window, or for products not in `products`, are ignored.
 */
export function aggregateMovement(
  audit: AuditRow[],
  products: ProductRef[],
  monthKeys: string[],
  options: AggregateOptions = {},
): MovementSummary {
  const { topN = 6, stockByProduct = {} } = options;
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
        totalReturned: 0,
        netSold: 0,
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

  for (const entry of audit) {
    const product = productById.get(entry.product_id);
    if (!product) continue;
    const key = monthKey(entry.created_at);
    if (!inWindow.has(key)) continue;

    const kind = classifyAction(entry.action);
    if (kind === "transfer" || kind === "adjustment") continue;

    const units = Math.abs(entry.quantity_change ?? 0);
    if (units === 0) continue;

    const cell = rowFor(product).months[key];
    if (kind === "sold") cell.sold += units;
    else if (kind === "returned") cell.returned += units;
    else if (kind === "received") cell.received += units;
  }

  const rows = [...byProduct.values()];
  for (const row of rows) {
    for (const key of monthKeys) {
      const cell = row.months[key];
      cell.netSold = cell.sold - cell.returned;
      row.totalSold += cell.sold;
      row.totalReturned += cell.returned;
      row.totalReceived += cell.received;
    }
    row.netSold = row.totalSold - row.totalReturned;
    row.netMovement = row.totalReceived - row.netSold;

    const price = productById.get(row.productId)?.net_price ?? 0;
    row.value = row.netSold * (price || 0);

    const series = monthKeys.map(k => row.months[k].netSold);
    const last = series[series.length - 1] ?? 0;
    const prev = series[series.length - 2] ?? 0;
    row.trendPct = pctChange(prev, last);
    row.windowChangePct = pctChange(series[0] ?? 0, last);
    row.direction = row.trendPct > FLAT_BAND ? "up" : row.trendPct < -FLAT_BAND ? "down" : "flat";
  }

  rows.sort((a, b) =>
    b.netSold - a.netSold ||
    b.totalReceived - a.totalReceived ||
    a.model.localeCompare(b.model));

  const totals: MovementTotals = {
    months: blankMonths(),
    sold: 0,
    returned: 0,
    netSold: 0,
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
      into.returned += from.returned;
      into.received += from.received;
      into.netSold += from.netSold;
    }
    totals.sold += row.totalSold;
    totals.returned += row.totalReturned;
    totals.received += row.totalReceived;
    totals.value += row.value;
    if (row.totalSold > 0 || row.totalReceived > 0) totals.modelsMoved += 1;
    else totals.modelsIdle += 1;
  }
  totals.netSold = totals.sold - totals.returned;
  totals.netMovement = totals.received - totals.netSold;

  const topModels = rows.filter(r => r.netSold > 0).slice(0, topN).map(r => r.model);
  const chartData = monthKeys.map(key => {
    const point: Record<string, string | number> = { month: shortMonth(key), key };
    for (const name of topModels) {
      const row = rows.find(r => r.model === name);
      point[name] = row ? row.months[key].netSold : 0;
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
    "Total sold", "Returned", "Net sold", "Received", "Net movement", "Stock on hand", "MoM %",
  ].join(",");

  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = rows.map(r => [
    r.model, r.sku, r.category ?? "",
    ...monthKeys.map(k => r.months[k].netSold),
    r.totalSold, r.totalReturned, r.netSold, r.totalReceived, r.netMovement, r.stockOnHand, r.trendPct,
  ].map(escape).join(","));

  return [header, ...lines].join("\n");
}

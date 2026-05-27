import * as XLSX from "xlsx";

export interface TallyPurchase {
  supplier_name: string;
  supplier_invoice_no: string;
  purchase_date: string; // YYYY-MM-DD
  line_items: {
    item_name: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
    discount_percent: number;
    gst_percent: number;
    gst_amount: number;
  }[];
}

const TALLY_HEADERS = [
  "Voucher Type", "Reference Number", "Date", "Payee Name", "Ledger Name",
  "Item Name", "Quantity", "Unit", "Rate", "Amount",
  "Discount", "Disc Type", "Tax Rate", "Tax Amount", "Narration",
];

function fmtDate(d: string) {
  // Tally prefers DD-MM-YYYY
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}

function rowsFor(p: TallyPurchase): (string | number)[][] {
  return p.line_items.map((it) => [
    "Purchase",
    p.supplier_invoice_no,
    fmtDate(p.purchase_date),
    p.supplier_name,
    "Purchases",
    it.item_name,
    it.quantity,
    it.unit,
    it.rate,
    it.amount,
    it.discount_percent,
    "%",
    `${it.gst_percent}%`,
    it.gst_amount,
    `Company Purchase - ${p.supplier_name}`,
  ]);
}

function csvEscape(v: string | number) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildTallyCsv(purchases: TallyPurchase[]): string {
  const rows: (string | number)[][] = [TALLY_HEADERS];
  for (const p of purchases) rows.push(...rowsFor(p));
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function downloadTallyExcel(filename: string, purchases: TallyPurchase[]) {
  const rows: (string | number)[][] = [TALLY_HEADERS];
  for (const p of purchases) rows.push(...rowsFor(p));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = TALLY_HEADERS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tally Import");
  XLSX.writeFile(wb, filename);
}

export function tallyFilename(p: TallyPurchase, ext: "csv" | "xlsx") {
  const supplier = p.supplier_name.replace(/\s+/g, "_").substring(0, 15);
  return `${supplier}_${p.supplier_invoice_no}_${p.purchase_date}.${ext}`;
}

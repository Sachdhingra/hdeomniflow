import * as XLSX from "xlsx";

// ── shared types ──────────────────────────────────────────────────────────────

export interface TallyLineItem {
  item_name: string;
  item_code?: string;
  hsn_code?: string;
  no_of_packings?: number;
  quantity: number;
  unit: string;
  rate: number;          // original rate (before discount)
  amount: number;        // net taxable amount (after discount, before GST)
  discount_percent: number;
  gst_percent: number;
  gst_amount: number;
}

export interface TallyPurchase {
  supplier_name: string;
  supplier_invoice_no: string;
  purchase_date: string; // YYYY-MM-DD
  line_items: TallyLineItem[];
}

// ── Tally ledger settings (configurable per company) ─────────────────────────

export interface TallySettings {
  supplyType: "intra" | "inter"; // intra = CGST+SGST, inter = IGST
  /**
   * Use {rate} for the GST % and {half} for CGST/SGST half-rate.
   * Examples: "Purchase @{rate}%" → "Purchase @18%"
   *           "Purchases"         → same ledger for all rates
   */
  purchaseLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
}

export const DEFAULT_TALLY_SETTINGS: TallySettings = {
  supplyType: "intra",
  purchaseLedger: "Purchase @{rate}%",
  cgstLedger: "Input CGST @{half}%",
  sgstLedger: "Input SGST @{half}%",
  igstLedger: "Input IGST @{rate}%",
};

const SETTINGS_KEY = "hde_tally_settings";

export function loadTallySettings(): TallySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_TALLY_SETTINGS, ...JSON.parse(raw) } : DEFAULT_TALLY_SETTINGS;
  } catch {
    return DEFAULT_TALLY_SETTINGS;
  }
}

export function saveTallySettings(s: TallySettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── date helpers ──────────────────────────────────────────────────────────────

function fmtDateDMY(d: string) {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}

function fmtDateTally(d: string) {
  // Tally XML needs YYYYMMDD
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d.replace(/-/g, "");
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

// ── CSV / Excel export (unchanged, kept for reference) ────────────────────────

const TALLY_CSV_HEADERS = [
  "Voucher Type", "Reference Number", "Date", "Payee Name",
  "Ledger Name", "HSN Code", "Item Name", "Item Code",
  "No. of Pkgs", "Quantity", "Unit", "Rate", "Disc%", "Taxable Amount",
  "GST%", "CGST Amount", "SGST Amount", "IGST Amount", "Total Amount",
  "Narration",
];

function csvRowsFor(p: TallyPurchase): (string | number)[][] {
  return p.line_items.map((it) => {
    const cgst = +(it.gst_amount / 2).toFixed(2);
    const sgst = cgst;
    return [
      "Purchase",
      p.supplier_invoice_no,
      fmtDateDMY(p.purchase_date),
      p.supplier_name,
      `Purchase @${it.gst_percent}%`,
      it.hsn_code ?? "",
      it.item_name,
      it.item_code ?? "",
      it.no_of_packings ?? "",
      it.quantity,
      it.unit,
      it.rate,
      it.discount_percent,
      it.amount,
      `${it.gst_percent}%`,
      cgst,
      sgst,
      0,
      +(it.amount + it.gst_amount).toFixed(2),
      `Company Purchase - ${p.supplier_name}`,
    ];
  });
}

function csvEscape(v: string | number) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildTallyCsv(purchases: TallyPurchase[]): string {
  const rows: (string | number)[][] = [TALLY_CSV_HEADERS];
  for (const p of purchases) rows.push(...csvRowsFor(p));
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
  const rows: (string | number)[][] = [TALLY_CSV_HEADERS];
  for (const p of purchases) rows.push(...csvRowsFor(p));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = TALLY_CSV_HEADERS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tally Import");
  XLSX.writeFile(wb, filename);
}

// ── Tally XML export ──────────────────────────────────────────────────────────
//
// Generates a Tally Data Exchange XML file that Tally Prime imports via:
//   Gateway of Tally → Import → Data → select this .xml file
//
// The Purchase voucher XML causes Tally to:
//   1. Create the purchase entry in the books
//   2. Update stock inward for every listed item (stock updation)
//   3. Book GST input credit automatically
//

function xmlEsc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolvePattern(pattern: string, gstRate: number): string {
  return pattern
    .replace(/\{rate\}/g, String(gstRate))
    .replace(/\{half\}/g, String(gstRate / 2));
}

interface GstGroup {
  rate: number;
  items: TallyLineItem[];
  subtotal: number;   // sum of item.amount in this group
  gstTotal: number;   // sum of item.gst_amount in this group
}

function groupByGst(items: TallyLineItem[]): GstGroup[] {
  const map = new Map<number, GstGroup>();
  for (const it of items) {
    if (!map.has(it.gst_percent)) {
      map.set(it.gst_percent, { rate: it.gst_percent, items: [], subtotal: 0, gstTotal: 0 });
    }
    const g = map.get(it.gst_percent)!;
    g.items.push(it);
    g.subtotal = +(g.subtotal + it.amount).toFixed(2);
    g.gstTotal = +(g.gstTotal + it.gst_amount).toFixed(2);
  }
  return Array.from(map.values()).sort((a, b) => a.rate - b.rate);
}

function inventoryEntryXml(it: TallyLineItem): string {
  // net rate per unit (amount / qty) so Tally qty × rate = amount
  const netRate = it.quantity > 0 ? +(it.amount / it.quantity).toFixed(2) : it.rate;
  return `        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${xmlEsc(it.item_name)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <RATE>${netRate.toFixed(2)}/${xmlEsc(it.unit || "NOS")}</RATE>
          <AMOUNT>-${it.amount.toFixed(2)}</AMOUNT>
          <ACTUALQTY>${it.quantity} ${xmlEsc(it.unit || "NOS")}</ACTUALQTY>
          <BILLEDQTY>${it.quantity} ${xmlEsc(it.unit || "NOS")}</BILLEDQTY>${it.hsn_code ? `\n          <HSNCODE>${xmlEsc(it.hsn_code)}</HSNCODE>` : ""}
        </ALLINVENTORYENTRIES.LIST>`;
}

function voucherXml(p: TallyPurchase, s: TallySettings): string {
  const groups = groupByGst(p.line_items);
  const grandTotal = p.line_items.reduce((sum, it) => sum + it.amount + it.gst_amount, 0);

  // Purchase ledger entries (one per GST slab, each contains its stock items)
  const purchaseLedgers = groups.map((g) => {
    const ledger = resolvePattern(s.purchaseLedger, g.rate);
    const invEntries = g.items.map(inventoryEntryXml).join("\n");
    return `      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEsc(ledger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-${g.subtotal.toFixed(2)}</AMOUNT>
${invEntries}
      </ALLLEDGERENTRIES.LIST>`;
  });

  // GST ledger entries (one per slab per tax type)
  const gstLedgers: string[] = [];
  if (s.supplyType === "intra") {
    groups.forEach((g) => {
      const half = +(g.gstTotal / 2).toFixed(2);
      gstLedgers.push(`      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEsc(resolvePattern(s.cgstLedger, g.rate))}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-${half.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
      gstLedgers.push(`      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEsc(resolvePattern(s.sgstLedger, g.rate))}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-${half.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
    });
  } else {
    groups.forEach((g) => {
      gstLedgers.push(`      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEsc(resolvePattern(s.igstLedger, g.rate))}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>-${g.gstTotal.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`);
    });
  }

  // Supplier / party ledger (credit side — balances the entry)
  const partyLedger = `      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEsc(p.supplier_name)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>${grandTotal.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;

  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>${fmtDateTally(p.purchase_date)}</DATE>
        <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
        <REFERENCE>${xmlEsc(p.supplier_invoice_no)}</REFERENCE>
        <PARTYLEDGERNAME>${xmlEsc(p.supplier_name)}</PARTYLEDGERNAME>
        <ISINVOICE>Yes</ISINVOICE>
        <NARRATION>Company Purchase - ${xmlEsc(p.supplier_name)} | Inv: ${xmlEsc(p.supplier_invoice_no)}</NARRATION>
${purchaseLedgers.join("\n")}
${gstLedgers.join("\n")}
${partyLedger}
      </VOUCHER>
    </TALLYMESSAGE>`;
}

export function buildTallyXml(purchases: TallyPurchase[], settings: TallySettings): string {
  const vouchers = purchases.map((p) => voucherXml(p, settings)).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>&#x200C;</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${vouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export function downloadXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── filename helpers ──────────────────────────────────────────────────────────

export function tallyFilename(p: TallyPurchase, ext: "csv" | "xlsx" | "xml") {
  const supplier = p.supplier_name.replace(/\s+/g, "_").substring(0, 15);
  return `${supplier}_${p.supplier_invoice_no}_${p.purchase_date}.${ext}`;
}

// ── Tally Masters XML export ──────────────────────────────────────────────────
//
// Resolves the "No Accounting entries are available" exception.
// Import this FIRST in Tally (Gateway → Import → Data) to create all
// ledgers and stock items referenced by the transactions XML.
// Tally skips entries that already exist — safe to import multiple times.
//

function ledgerMsgXml(name: string, parent: string, extraLines = ""): string {
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${xmlEsc(name)}" ACTION="Create">
        <NAME>${xmlEsc(name)}</NAME>
        <PARENT>${xmlEsc(parent)}</PARENT>
${extraLines}      </LEDGER>
    </TALLYMESSAGE>`;
}

function stockItemMsgXml(name: string, unit: string, hsn: string, gstRate: number): string {
  const hsnBlock = hsn
    ? `        <HSNDETAILS.LIST>
          <HSNCODE>${xmlEsc(hsn)}</HSNCODE>
          <TAXABILITY>Taxable</TAXABILITY>
          <STATEWISEDETAILS.LIST>
            <STATENAME>All States</STATENAME>
            <RATEDETAILS.LIST>
              <GSTSLABNAME>Goods</GSTSLABNAME>
              <RATE>${gstRate}%</RATE>
            </RATEDETAILS.LIST>
          </STATEWISEDETAILS.LIST>
        </HSNDETAILS.LIST>`
    : "";
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="${xmlEsc(name)}" ACTION="Create">
        <NAME>${xmlEsc(name)}</NAME>
        <PARENT>Primary</PARENT>
        <BASEUNITS>${xmlEsc(unit || "NOS")}</BASEUNITS>
        <GSTAPPLICABLE>&#x200C;Applicable</GSTAPPLICABLE>
${hsnBlock}
      </STOCKITEM>
    </TALLYMESSAGE>`;
}

export function buildTallyMastersXml(purchases: TallyPurchase[], settings: TallySettings): string {
  // Collect unique GST rates, suppliers, and stock items
  const gstRates = new Set<number>();
  const suppliers = new Set<string>();
  const stockItems = new Map<string, { unit: string; hsn: string; gstRate: number }>();

  for (const p of purchases) {
    suppliers.add(p.supplier_name);
    for (const it of p.line_items) {
      gstRates.add(it.gst_percent);
      if (!stockItems.has(it.item_name)) {
        stockItems.set(it.item_name, {
          unit: it.unit || "NOS",
          hsn: it.hsn_code || "",
          gstRate: it.gst_percent,
        });
      }
    }
  }

  const messages: string[] = [];

  // 1. Purchase ledger(s) — one per GST slab → parent: Purchase Accounts
  for (const rate of gstRates) {
    const name = resolvePattern(settings.purchaseLedger, rate);
    messages.push(ledgerMsgXml(name, "Purchase Accounts",
      `        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <GSTAPPLICABLE>&#x200C;Applicable</GSTAPPLICABLE>
`));
  }

  // 2. GST input ledger(s) → parent: Duties & Taxes
  for (const rate of gstRates) {
    if (settings.supplyType === "intra") {
      const cgst = resolvePattern(settings.cgstLedger, rate);
      const sgst = resolvePattern(settings.sgstLedger, rate);
      messages.push(ledgerMsgXml(cgst, "Duties &amp; Taxes",
        `        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <TAXTYPE>Central Tax</TAXTYPE>
        <GSTAPPLICABLE>&#x200C;Applicable</GSTAPPLICABLE>
`));
      messages.push(ledgerMsgXml(sgst, "Duties &amp; Taxes",
        `        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <TAXTYPE>State Tax</TAXTYPE>
        <GSTAPPLICABLE>&#x200C;Applicable</GSTAPPLICABLE>
`));
    } else {
      const igst = resolvePattern(settings.igstLedger, rate);
      messages.push(ledgerMsgXml(igst, "Duties &amp; Taxes",
        `        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <TAXTYPE>Integrated Tax</TAXTYPE>
        <GSTAPPLICABLE>&#x200C;Applicable</GSTAPPLICABLE>
`));
    }
  }

  // 3. Supplier ledger(s) → parent: Sundry Creditors
  for (const supplier of suppliers) {
    messages.push(ledgerMsgXml(supplier, "Sundry Creditors",
      `        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
`));
  }

  // 4. Stock items
  for (const [name, info] of stockItems) {
    messages.push(stockItemMsgXml(name, info.unit, info.hsn, info.gstRate));
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>&#x200C;</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

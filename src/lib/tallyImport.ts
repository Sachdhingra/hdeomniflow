/**
 * Tally Prime → Omniflow stock import parser.
 *
 * Supported CSV formats
 * ─────────────────────
 * FORMAT A – "OMNI Stock Import" (recommended, easy to create from Tally):
 *   Item Name, Item Code, Closing Qty, Unit
 *   GODREJ SAFE MODEL X, GS-001, 5, NOS
 *
 * FORMAT B – Tally Prime "Stock Summary" native export (auto-detected):
 *   Particulars, Opening Qty, Inward Qty, Outward Qty, Closing Qty, Unit
 *   GODREJ SAFE MODEL X, 2, 5, 0, 7, NOS
 *
 * Both formats are detected by header row inspection.
 */

export interface TallyStockRow {
  itemName: string;
  itemCode: string;       // empty string when not provided
  closingQty: number;
  unit: string;
  rawRow: Record<string, string>;
}

export interface ParseResult {
  rows: TallyStockRow[];
  format: "OMNI" | "TALLY_SUMMARY" | "UNKNOWN";
  errors: string[];
}

// ── low-level helpers ────────────────────────────────────────────────────────

function normalise(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseQty(raw: string): number {
  // Tally sometimes encodes "5 NOS" or "5.00 NOS" in the qty cell
  const n = parseFloat(raw.replace(/[^\d.]/g, "") || "0");
  return isNaN(n) ? 0 : n;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseCsvLine(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

// ── format detection ─────────────────────────────────────────────────────────

function detectFormat(headers: string[]): "OMNI" | "TALLY_SUMMARY" | "UNKNOWN" {
  const norm = headers.map(normalise);
  if (norm.includes("closingqty") || norm.includes("closingbalance")) return "TALLY_SUMMARY";
  if (norm.includes("itemname") || norm.includes("name")) return "OMNI";
  if (norm.includes("particulars")) return "TALLY_SUMMARY";
  return "UNKNOWN";
}

// ── per-format extractors ────────────────────────────────────────────────────

function extractOmni(row: Record<string, string>, headers: string[]): TallyStockRow | null {
  // flexible header matching
  const norm = (k: string) => normalise(k);
  const get = (keys: string[]) => {
    const found = headers.find(h => keys.includes(norm(h)));
    return found ? row[found] ?? "" : "";
  };

  const itemName = get(["itemname", "name", "stockitem", "item"]).trim();
  if (!itemName) return null;
  const itemCode = get(["itemcode", "code", "alias", "sku"]).trim();
  const qtyRaw = get(["closingqty", "qty", "quantity", "closing", "closingbalance"]);
  const unit = get(["unit", "uom", "uofm"]).trim();

  return { itemName, itemCode, closingQty: parseQty(qtyRaw), unit, rawRow: row };
}

function extractTallySummary(row: Record<string, string>, headers: string[]): TallyStockRow | null {
  const norm = (k: string) => normalise(k);
  const get = (keys: string[]) => {
    const found = headers.find(h => keys.includes(norm(h)));
    return found ? row[found] ?? "" : "";
  };

  const itemName = get(["particulars", "stockitem", "itemname", "name"]).trim();
  if (!itemName || itemName.startsWith("---") || itemName.toLowerCase() === "total") return null;

  const closingRaw = get(["closingqty", "closingbalance", "closingstock", "closing"]);
  const outwardRaw = get(["outwardqty", "outwards", "issued", "sales"]);
  const inwardRaw  = get(["inwardqty",  "inwards",  "purchased", "receipts"]);
  const openingRaw = get(["openingqty", "openingbalance", "opening"]);

  // Prefer explicit closing; fallback to opening+inward-outward
  let closingQty: number;
  if (closingRaw) {
    closingQty = parseQty(closingRaw);
  } else {
    closingQty = parseQty(openingRaw) + parseQty(inwardRaw) - parseQty(outwardRaw);
  }

  // Unit may be embedded in closing cell like "7 NOS" – extract it
  const unitFromCell = closingRaw?.match(/[A-Za-z]+/)?.[0] ?? "";
  const unitExplicit = get(["unit", "uom", "uofm"]).trim();
  const unit = unitExplicit || unitFromCell;

  return { itemName, itemCode: "", closingQty, unit, rawRow: row };
}

// ── public API ───────────────────────────────────────────────────────────────

export function parseTallyStockCsv(text: string): ParseResult {
  const errors: string[] = [];
  const { headers, rows: rawRows } = parseCsv(text);

  if (!headers.length) {
    return { rows: [], format: "UNKNOWN", errors: ["Empty or unreadable file."] };
  }

  const format = detectFormat(headers);
  if (format === "UNKNOWN") {
    return {
      rows: [],
      format,
      errors: [
        "Unrecognised column headers. Expected 'Item Name' (OMNI format) or 'Particulars'/'Closing Qty' (Tally Summary format).",
      ],
    };
  }

  const rows: TallyStockRow[] = [];
  rawRows.forEach((raw, i) => {
    const row = format === "OMNI"
      ? extractOmni(raw, headers)
      : extractTallySummary(raw, headers);
    if (!row) return;
    if (row.closingQty < 0) {
      errors.push(`Row ${i + 2}: negative quantity for "${row.itemName}" — skipped.`);
      return;
    }
    rows.push(row);
  });

  return { rows, format, errors };
}

// ── sample CSV generator (for "Download Template" button) ────────────────────

export function buildOmniStockTemplate(): string {
  const headers = ["Item Name", "Item Code", "Closing Qty", "Unit"];
  const sample = [
    ["GODREJ INTERIO SAFE S-350E", "GS-350E", "5", "NOS"],
    ["GODREJ INTERIO CHAIR ARIA", "GC-ARIA", "3", "NOS"],
    ["GODREJ INTERIO WALL RACK WR-1", "GWR-1", "8", "NOS"],
  ];
  return [headers, ...sample]
    .map(r => r.map(v => `"${v}"`).join(","))
    .join("\n");
}

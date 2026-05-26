# Tally Import System – Company Purchases

Build a full Accounts module to record company purchases (Godrej and others), then export them as Tally-compatible CSV/Excel for one-click import into Tally Prime.

## Scope

### 1. Database (migration)
- `company_purchases` — header (purchase_number auto via sequence, supplier_name, supplier_invoice_no, purchase_date, voucher_class default `PURCHASE GST`, currency `INR`, status `Draft|Confirmed|Tally Exported`, tally_import_status `Pending|Exported|Failed`, tally_exported_at, totals cache, created_by/at, updated_at).
- `purchase_line_items` — purchase_id FK, item_name, item_code, quantity, unit, rate, discount_percent, amount, hsn_code, gst_percent (default 5), gst_amount, line_total.
- `suppliers` (small lookup) seeded with `GODREJ AND BOYCE MANUFACTURING CO LTD`. Admins can add more.
- RLS: only `admin` and `accounts` roles can read/write. Trigger to auto-compute amount/gst/line_total and update header totals + updated_at. Trigger to assign `purchase_number` (PO-001 style) on insert.
- Storage bucket `purchase-pdfs` (private) with RLS for admin/accounts to upload/read.

### 2. Edge function `extract-purchase-pdf`
- Accepts PDF (file path in storage or base64).
- Calls Lovable AI (`google/gemini-2.5-flash`) with the PDF to extract: supplier_name, supplier_invoice_no, purchase_date, and line items (name, code, qty, unit, rate, discount%, hsn, gst%).
- Returns structured JSON for the UI to pre-fill the form.

### 3. UI — new page `/accounts/purchases` (admin + accounts roles)
- **List view**: table of purchases with filters (status, supplier, date range), summary cards (total this month, pending Tally import, exported), bulk-select for batch CSV export.
- **Add / Edit dialog**:
  - Header: supplier dropdown (with "+ Add supplier"), invoice no, date, voucher class, currency.
  - Line items: add/remove rows with item name (typeahead from `godrej_products`), code, qty, unit, rate, discount%, hsn, gst%. Auto-calculated amount, gst amount, line total. Footer totals.
  - Buttons: Save Draft, Confirm, **Upload PDF (auto-extract)**, **Generate Tally CSV**, **Generate Tally Excel**.
- **Detail drawer**: header info, items, status timeline, actions (Download CSV/Excel, Mark as Imported, Edit, Delete).

### 4. CSV / Excel generation (client-side)
- CSV headers: `Voucher Type, Reference Number, Date, Payee Name, Ledger Name, Item Name, Quantity, Unit, Rate, Amount, Discount, Disc Type, Tax Rate, Tax Amount, Narration`.
- One row per line item. Filename `{Supplier}_{InvoiceNo}.csv`.
- Excel via `xlsx` package with same columns, currency formatting, header styling.
- Batch export concatenates rows across selected purchases into a single file.
- On successful export, update `tally_import_status='Exported'` and `tally_exported_at=now()`, status → `Tally Exported`.

### 5. Routing & navigation
- Add route in `src/App.tsx` for both `admin` and `accounts` roles.
- Add sidebar menu link "Company Purchases" under Accounts in `AppLayout`.

### 6. Dashboard summary card
- Small card on `AccountsApprovals` / Admin dashboard showing month-to-date totals and pending-Tally counts (link through).

## Technical notes
- Use `zod` for line-item validation; show inline errors.
- All money formatted with `Intl.NumberFormat('en-IN')`.
- GST auto-calc: `amount = qty*rate*(1-discount/100)`, `gst_amount = amount*gst%/100`, `line_total = amount + gst_amount`. Done in DB trigger and mirrored in UI.
- Use existing `supabase` client and shadcn components (Dialog, Table, Select, Input).
- Add `xlsx` dependency (lightweight, already common).

## Out of scope (can be added later)
- Direct Tally API push (Tally requires desktop XML import or ODBC; CSV download is the standard handoff).
- Multi-currency conversion.
- Approval workflow beyond Draft → Confirmed → Exported.

Approve and I'll implement.
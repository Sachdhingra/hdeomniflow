## Important: which inventory system to apply this to

This app has **two parallel inventory systems**:

- `display_inventory` / `pending_display` / `inventory_audit_log` / `inventory_products` — older tables, only used by the Self-Delivery trigger on `service_jobs`. Most products live in `products`, not `inventory_products`, so this system is effectively dormant.
- `hde_inventory` + `hde_locations` + `hde_orders` — the system actually powering Inventory Manager (the screen in your screenshot).

Your rules talk about "display_inventory" and "quantity_on_display", but the screen you're using is the HDE one. I'll **apply the rules to the HDE system** (the live one) and treat each `hde_inventory` row with `inventory_type='display'` (i.e. a showroom row) as the "display stock". If you actually meant the dormant tables, tell me and I'll redirect.

---

## A. Order timeline — show ALL codes

Fix `CreateOrderDialog.handleCreate` so the "Order Created" timeline row lists the sold SKU **plus every replacement SKU** added on that order (currently only the sold product is named). Description becomes:
`Sold via Showroom — MAGNUS PRO QN BED — Qty: 1 — Replacement: UPMDS Lind HB+TB Qn Brn`

No schema change; pure text edit in `src/pages/InventoryManager.tsx` around line 737–741.

## 1. Sale block on zero display stock (Showroom sales)

In `CreateOrderDialog` when `mode === "showroom"`:
- Look up the showroom location's qty for the sold product.
- If 0 → block submission with: *"Insufficient display stock. Contact admin."*
- Admin only: show a checkbox **Override (admin)** plus a mandatory `override_reason` textarea. Override writes a row to the new `inventory_audit_log` (HDE) with `action='admin_override_sale'`, `reason`, `created_by`.

(Warehouse and Company-order modes are unaffected — they're not display stock.)

## 2. Remove manual quantity controls from sales view

In `StockTable` and the per-cell editor in the Articles tab:
- Sales / site_agent / accounts / service_head: read-only cells (no Edit2, no +/- buttons).
- Admin: keeps current edit + Receive Stock + delete.
- "Receive Stock" stays admin-only (currently anyone can press it).
- The system trigger on sale (existing inventory decrement in `handleCreate`) is the only sales-path mutation.

## 3. Stock Count page (admin only) — new tab inside Inventory Manager

New `StockCountView` component, rendered under a new `stock-count` tab (admin only). It lists every tracked article with:

```text
[Article]  [SKU]  [System Qty (per location)]  [Physical Count input]  [Variance]  [Reason if ≠ 0]
```

On **Submit Count**:
- Diff each row's physical vs system per location.
- Update `hde_inventory.quantity` to the physical count.
- Insert one `inventory_audit_log` row per changed cell: `action='stock_count'`, `quantity_change = physical − system`, `reason`, `created_by`.
- Show a variance summary table after submit.

## 4. Audit Log tab (admin only) — new tab inside Inventory Manager

New `AuditLogView`. Reads `inventory_audit_log` joined with profile names + product names + lead refs. Columns: `created_at | product | action | qty change | user | lead_id`.
Rows where `lead_id IS NULL AND action='manual_adjustment'` get an amber/red row class.
Includes basic filters (date range, action type, product search) + CSV export.

## 5. Pending Display resolution

On the Articles tab (or new "Pending Display" admin section in the Stock tab), for each row in `pending_display`:
- Show product + days since `date_marked`.
- Rows older than 7 days → amber background, amber badge "Awaiting >7d".
- **Mark as Displayed** button → deletes the `pending_display` row and inserts `inventory_audit_log` with `action='pending_resolved'`.

---

## Schema changes (single migration)

Add to `inventory_audit_log` (currently keyed to `inventory_products`):
- Drop the FK to `inventory_products(id)` so it can also store HDE product references (or add `hde_product_id UUID` column — I'll go with **dropping the FK** and keeping `product_id UUID NOT NULL`, since both systems already use the same `products` UUIDs in practice via HDE).
- Add `reason TEXT NULL`.
- Add `location_id UUID NULL` (for stock_count / showroom-scoped entries).
- Backfill-safe; preserve existing RLS + GRANTs.

No new tables needed.

---

## Files touched

- `supabase/migrations/<new>.sql` — alter `inventory_audit_log`
- `src/pages/InventoryManager.tsx` — bug A fix, sale block + override UI, gate quantity edits to admin, new `StockCountView`, new `AuditLogView`, new `PendingDisplayView`, new tabs

## Out of scope (call out if you want them)

- Self-Delivery dialog already writes to the dormant `display_inventory` — I'll leave that alone unless you say otherwise.
- No changes to the warehouse-request flow.
- No new admin dashboard tile; the amber >7d highlight lives inside Inventory Manager.

Approve and I'll ship the migration first, then the UI in one pass.
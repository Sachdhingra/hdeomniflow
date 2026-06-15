## Logistics & Service Calculator Module

A new module under Operations with 6 calculators, admin-editable rate masters, history tracking, and quote integration.

### Scope

**New route**: `/logistics-calculator` — visible to admin, sales, service_head, accounts in sidebar (under existing nav, labeled "Logistics Calc" with Calculator icon).

**Admin-only sub-route**: `/logistics-calculator/settings` for rate management and kitchen visit locations.

### Database (new tables)

1. `logistics_rates` (singleton key-value config)
   - keys: `local_freight_per_km`, `outstation_freight_per_km`, `handling_per_km`, `floor_labour_rate`, `modular_labour_rate`, `minimum_charge`, `gst_rate`
   - Editable by admin only; readable by all permitted roles

2. `kitchen_visit_locations`
   - `location_name`, `charge`, `active`
   - Seeded with the 12 locations provided
   - Admin manages; all permitted roles read

3. `logistics_calculations` (history)
   - `calculator_type` (enum: local_freight, outstation_freight, handling, floor_labour, modular_labour, kitchen_visit)
   - `customer_name`, `customer_phone`, `lead_id` (nullable FK)
   - `inputs` (jsonb), `breakdown` (jsonb), `subtotal`, `gst_amount`, `final_amount`, `gst_included` (bool)
   - `attached_to_lead` (bool), `created_by`
   - RLS: sales sees own; admin/sales_manager/service_head/accounts see all

### Calculators (UI)

Tabbed interface, each calculator gets a card with:
- Inputs (number fields, GST toggle, dropdowns)
- Live computed breakdown
- Large final amount card with Copy Amount / Copy Full Calculation / Print buttons
- "Save to History" button (auto on Attach)
- "Attach to Quote" — opens lead picker, saves snapshot and appends a note line on the lead

Formulas exactly per spec, all rates pulled from `logistics_rates` so admin edits propagate instantly.

### History page

Table with date, customer, type, final amount, created_by. Search by customer, filters by type/date/creator. Export to Excel (xlsx) and PDF (jsPDF) — both libraries already available.

### Permissions matrix

Implemented via RLS + UI gating:
| Role | Calculate | Attach to quote | View all | Manage rates |
|---|---|---|---|---|
| sales | ✓ | ✓ | own only | – |
| service_head | ✓ | ✓ | ✓ | – |
| accounts | ✓ | – | ✓ + export | – |
| admin | ✓ | ✓ | ✓ | ✓ |

(No separate "sales_manager" role exists in the system — admin role covers manager use cases. I'll treat admin = manager.)

### Quote integration

The project doesn't yet have a formal "quote" entity. I'll integrate via the existing **leads** workflow: "Attach to Quote" picks a lead and appends a structured line to `leads.notes` plus stores a row in `logistics_calculations` with `lead_id`, viewable from lead detail (small new section "Logistics charges"). This is the lightest path that fits the current schema.

### Files

- Migration: 3 tables + seed data + RLS + grants
- `src/pages/LogisticsCalculator.tsx` — tabbed calculators
- `src/pages/LogisticsCalculatorSettings.tsx` — admin rates + kitchen locations
- `src/pages/LogisticsHistory.tsx` — history + export
- `src/components/logistics/*` — one component per calculator + AttachToQuoteDialog + ResultCard
- `src/lib/logisticsExport.ts` — xlsx + pdf export helpers
- Routing in `src/App.tsx`, nav entries in `src/components/AppLayout.tsx`

### Out of scope / assumptions
- No "sales_manager" role added — admin acts as manager
- Quote attachment uses existing leads.notes + new history row (no new quotations table)
- Dark mode already supported by design tokens — no extra work

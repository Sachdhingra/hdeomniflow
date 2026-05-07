# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

FurnCRM — a furniture sales & service CRM for a Dehradun-based furniture company. It manages leads through a sales pipeline, field/site agent operations, service jobs, WhatsApp automation, and a real-time internal chat. The app is role-gated: each of the six user roles sees a different set of routes and data.

## Commands

```bash
npm run dev          # start Vite dev server on port 8080
npm run build        # production build
npm run lint         # ESLint
npm run test         # run Vitest unit tests once
npm run test:watch   # Vitest in watch mode
```

Run a single test file:
```bash
npx vitest run src/path/to/file.test.ts
```

## Architecture

### Frontend (React + Vite + TypeScript)

**`src/App.tsx`** is the entry point. It wires up providers (`QueryClient`, `AuthProvider`, `DataProvider`, `BrowserRouter`) and renders routes. Route access is controlled by a `switch (user.role)` block — adding a page for a specific role means adding a `<Route>` inside its case.

**`src/contexts/AuthContext.tsx`** manages Supabase auth. Login converts a plain username to `{username}@furncrm.local` before calling `signInWithPassword`. The app version (`APP_VERSION = "1.3.0"`) triggers a localStorage cache clear on upgrade while preserving `sb-*` auth tokens. Roles are fetched via the `get_user_role` RPC after authentication.

**`src/contexts/DataContext.tsx`** is the global data store. It loads data in three stages:
1. **Stage 1 (instant):** `get_dashboard_summary` RPC + profiles
2. **Stage 2 (foreground):** paginated leads (20/page)
3. **Stage 3 (background):** service jobs, site visits, notifications

All mutations use optimistic updates and roll back to a fresh fetch on error. Soft-delete is implemented via `deleted_at`/`deleted_by` columns. Data is cached in localStorage with a 5-minute TTL under the `furncrm_cache_*` prefix. Real-time Supabase subscriptions are debounced (800ms for leads/jobs, 1500ms for summary) to avoid rapid refetches.

**`src/integrations/supabase/`** — the Supabase client (`client.ts`) and generated type definitions (`types.ts`). Import the client as `import { supabase } from "@/integrations/supabase/client"`. Types from `types.ts` are surfaced as `Tables<"table_name">`, `TablesInsert<"table_name">`, and `Enums<"enum_name">` — use these rather than hand-rolling interfaces.

**`src/components/AppLayout.tsx`** renders the sidebar with per-role navigation items (`NAV_ITEMS` record), a topbar with `NetworkStatusBadge` and `NotificationPanel`, and wraps all page content. `@` path alias resolves to `src/`.

**`src/lib/leadConstants.ts`** holds all option lists (neighborhoods, budget ranges, decision timelines, etc.) and color/formatting helpers for lead fields. Add new lead field options here, not inline in components.

### Supabase Edge Functions (Deno)

Located in `supabase/functions/`. Each is a Deno HTTP handler. Shared utilities live in `supabase/functions/_shared/`.

| Function | Purpose |
|---|---|
| `ai-assistant` | Claude-powered business coach; role-scoped context injection; restricted to admin/sales/service_head |
| `send-whatsapp` | Outbound WhatsApp via Twilio through the Lovable connector gateway (`connector-gateway.lovable.dev/twilio`) |
| `interakt-webhook` | Inbound WhatsApp webhook from Meta Cloud API; verifies HMAC signature; calls `analyzeInbound` |
| `nurture-engine` | Autonomous daily/twice-daily lead nurture; picks templates from conversation analysis |
| `daily-summary` | Daily summary report |
| `daily-excel-report` | Excel report generation |
| `godrej-scrape` | Product scraper for Godrej catalog |
| `create-user` / `manage-user` | Admin user management |

`supabase/functions/_shared/conversation-analysis.ts` provides `analyzeInbound` (classifies sentiment, concern, intent from a WhatsApp message) and `pickTemplateTitle` — used by both `interakt-webhook` and `nurture-engine`.

`supabase/config.toml` disables JWT verification for `nurture-engine` and `interakt-webhook` since they are called by external services.

### Database Schema Key Points

**Roles** (`app_role` enum): `admin`, `sales`, `service_head`, `field_agent`, `site_agent`, `accounts`

**Lead statuses** (`lead_status` enum): `new → contacted → follow_up → negotiation → won/lost/overdue/converted`

**Service job statuses** (`service_job_status` enum): `pending → assigned → in_progress → on_route → on_site → completed`, plus `rescheduled`, `pending_accounts_approval`, `accounts_rejected`

**Service job types** (`service_job_type` enum): `service`, `delivery`, `self_delivery`

Key RPC functions: `get_dashboard_summary`, `get_user_role`, `calculate_conversion_probability`, `detect_journey_stage`, `get_or_create_dm_channel`, `ensure_default_chat_channels`.

Soft-delete is on `leads`, `service_jobs`, and `site_visits` via `deleted_at` column. Hard deletes write to `deletion_logs`. All queries filter `.is("deleted_at", null)`.

Row-level security enforces role-based data access at the database level — the frontend does not need to re-implement access logic.

### UI Conventions

- Components use shadcn/ui (`src/components/ui/`) built on Radix UI primitives.
- Icons come exclusively from `lucide-react`.
- Toasts use `sonner` (`import { toast } from "sonner"`).
- Tailwind CSS with a custom design token system — use semantic tokens (`text-primary`, `bg-destructive`, `text-success`, `text-warning`) rather than hardcoded colors.
- The app is a PWA (see `public/manifest.json`). Avoid registering new service workers; the auth flow explicitly unregisters stale ones on startup.

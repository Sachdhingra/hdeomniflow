-- Prevent duplicate entries from rapid multiple clicks (lead entries & work assignment)
--
-- 1. Soft-delete existing duplicates (recoverable from Admin > Deleted Records)
-- 2. Enforce uniqueness at the database level with partial unique indexes,
--    so even concurrent submissions from any user cannot create duplicates.

-- ── Leads: one active lead per phone number ────────────────────────────────
-- Soft-delete newer duplicates, keeping the earliest active lead per phone.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY customer_phone
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.leads
  WHERE deleted_at IS NULL
    AND customer_phone IS NOT NULL
)
UPDATE public.leads l
SET deleted_at = now()
FROM ranked r
WHERE l.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_lead_phone
  ON public.leads (customer_phone)
  WHERE deleted_at IS NULL;

-- ── Service jobs: one pending-approval dispatch per lead & type ────────────
-- Soft-delete newer duplicate dispatches still awaiting accounts approval,
-- keeping the earliest one per (source_lead_id, type).
WITH ranked_jobs AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY source_lead_id, type
           ORDER BY date_received ASC, id ASC
         ) AS rn
  FROM public.service_jobs
  WHERE deleted_at IS NULL
    AND source_lead_id IS NOT NULL
    AND accounts_approval_status = 'pending'
)
UPDATE public.service_jobs j
SET deleted_at = now()
FROM ranked_jobs r
WHERE j.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_dispatch_per_lead
  ON public.service_jobs (source_lead_id, type)
  WHERE deleted_at IS NULL
    AND source_lead_id IS NOT NULL
    AND accounts_approval_status = 'pending';

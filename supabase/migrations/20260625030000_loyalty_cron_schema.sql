-- Elite Card Loyalty — Step 4: Cron Schema
-- Adds date_of_birth, last_purchase_date; trigger to maintain last_purchase_date;
-- pg_cron daily schedule for loyalty-cron edge function.

-- ============================================================
-- 1. SCHEMA ADDITIONS on elite_customers
-- ============================================================

ALTER TABLE public.elite_customers
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS last_purchase_date DATE;

COMMENT ON COLUMN public.elite_customers.date_of_birth     IS 'Used for birthday push notification';
COMMENT ON COLUMN public.elite_customers.last_purchase_date IS 'Updated by trigger on bill approval; used for dormancy check';

-- ============================================================
-- 2. TRIGGER: update last_purchase_date when a bill is approved
--    (non-return only; piggybacks on fn_credit_or_reverse_points timing)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_last_purchase_date()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only fires on transition → 'approved' for non-return entries
  IF NEW.approval_status = 'approved'
     AND OLD.approval_status <> 'approved'
     AND NEW.is_return = FALSE
  THEN
    UPDATE public.elite_customers
       SET last_purchase_date = GREATEST(COALESCE(last_purchase_date, '1970-01-01'::DATE), NEW.bill_date)
     WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_last_purchase_date ON public.card_bill_entries;
CREATE TRIGGER trg_update_last_purchase_date
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_last_purchase_date();

-- ============================================================
-- 3. pg_cron: schedule loyalty-cron edge function daily at 08:00 IST
--    IST = UTC+5:30, so 08:00 IST = 02:30 UTC
--    Requires pg_cron + pg_net extensions (enabled in Supabase dashboard).
--    The edge function URL is constructed from SUPABASE_URL env var at
--    runtime; here we reference it via the project ref placeholder.
--
--    IMPORTANT: Replace <project-ref> with your actual Supabase project ref
--    before running, OR use the Supabase Dashboard → Database → Cron Jobs UI
--    to create the schedule pointing to:
--      https://<project-ref>.supabase.co/functions/v1/loyalty-cron
-- ============================================================

-- Remove old job if it exists
SELECT cron.unschedule('loyalty-daily-cron')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'loyalty-daily-cron'
  );

-- Schedule: 02:30 UTC every day
-- The edge function validates the x-internal-secret header.
-- Set LOYALTY_CRON_SECRET in Supabase Dashboard → Edge Functions → Secrets.
-- We store it in pg_cron via net.http_post so it never appears in app code.
DO $$
BEGIN
  PERFORM cron.schedule(
    'loyalty-daily-cron',
    '30 2 * * *',
    $$
      SELECT net.http_post(
        url     := current_setting('app.supabase_functions_url') || '/loyalty-cron',
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'x-internal-secret', current_setting('app.loyalty_cron_secret')
        ),
        body    := '{}'::jsonb
      );
    $$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron / pg_net may not be available in local dev; skip silently.
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$$;

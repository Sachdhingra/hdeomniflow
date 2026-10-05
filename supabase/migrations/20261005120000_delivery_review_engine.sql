-- Delivery review engine
-- ============================================================================
-- After every completed delivery, WhatsApp the customer our Google review link,
-- then share our website with them.
--
--   1. service_jobs (type delivery / self_delivery) flips to status
--      'completed'  →  queue a 'delivery_review' message (sent within seconds)
--                       and a 'website_share' message scheduled
--                       `website_share_delay_hours` (default 48) later.
--      Google offers no "review posted" webhook, so for delivery customers the
--      website link follows the review ask after a delay instead of waiting on
--      a confirmation that never comes.
--   2. customer_feedback.reviewed_on_google flips to true (kiosk "I've left my
--      review" button, or an admin ticking it off)  →  queue a 'website_share'
--      straight away.
--
-- Both are drained by the existing feedback-whatsapp edge function, which owns
-- the wording (supabase/functions/_shared/kiosk-messages.ts) and the
-- guard rails: no review ask after a negative WhatsApp reply, no website link
-- once the customer has replied negatively, at most one of each per customer
-- per 30 days.
--
-- Written defensively (IF NOT EXISTS everywhere) because the queue columns
-- from 20260921120000 may not exist on every database.
-- ============================================================================

-- ── 1. Settings ─────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value) VALUES
  ('delivery_review_enabled',     'true'),
  ('website_share_enabled',       'true'),
  ('website_url',                 'https://hdefurniture.netlify.app'),
  -- Hours between the delivery review ask and the website link.
  ('website_share_delay_hours',   '48'),
  -- Twilio Content (template) SIDs. Empty = send as free text (only reaches
  -- customers inside the 24h WhatsApp session window).
  --   delivery_review_content_sid  vars: {{1}} first name, {{2}} review URL
  --   website_share_content_sid    vars: {{1}} first name, {{2}} website URL
  ('delivery_review_content_sid', ''),
  ('website_share_content_sid',   '')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Queue columns ────────────────────────────────────────────────────────

ALTER TABLE public.pending_thank_you_messages
  ADD COLUMN IF NOT EXISTS kind                text NOT NULL DEFAULT 'kiosk_welcome',
  ADD COLUMN IF NOT EXISTS draw_id             uuid,
  ADD COLUMN IF NOT EXISTS attempts            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at     timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS service_job_id      uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id             uuid,
  ADD COLUMN IF NOT EXISTS customer_name       text;

ALTER TABLE public.pending_thank_you_messages
  ALTER COLUMN feedback_id DROP NOT NULL;
ALTER TABLE public.pending_thank_you_messages
  ALTER COLUMN message SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pending_thank_you_pending
  ON public.pending_thank_you_messages (status, scheduled_send_time)
  WHERE status = 'pending';

-- A delivery toggled completed → in_progress → completed must not message the
-- customer twice, and a review confirmed twice must not share the site twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_thank_you_job_kind
  ON public.pending_thank_you_messages (service_job_id, kind)
  WHERE service_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_thank_you_website_feedback
  ON public.pending_thank_you_messages (feedback_id)
  WHERE kind = 'website_share' AND feedback_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_thank_you_phone_kind
  ON public.pending_thank_you_messages (phone, kind, created_at DESC);

-- ── 3. pg_net dispatch helper (same as 20260921120000; recreated in case
--       that migration never reached this database) ─────────────────────────

CREATE OR REPLACE FUNCTION public._invoke_feedback_whatsapp(_payload jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $fn$
DECLARE
  v_secret     text;
  v_base       text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'LOYALTY_CRON_SECRET'
   LIMIT 1;

  IF COALESCE(v_secret, '') = '' THEN
    v_secret := current_setting('app.loyalty_cron_secret', true);
  END IF;

  IF COALESCE(v_secret, '') = '' THEN
    RAISE WARNING 'feedback WhatsApp not dispatched: LOYALTY_CRON_SECRET is set in neither vault nor app.loyalty_cron_secret';
    RETURN NULL;
  END IF;

  v_base := COALESCE(
    current_setting('app.supabase_functions_url', true),
    'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1'
  );

  SELECT net.http_post(
    url     := v_base || '/feedback-whatsapp',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := COALESCE(_payload, '{}'::jsonb)
  ) INTO v_request_id;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'feedback WhatsApp dispatch skipped: %', SQLERRM;
  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_feedback_whatsapp(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. Delivery completed → review ask + delayed website share ──────────────

CREATE OR REPLACE FUNCTION public.fn_queue_delivery_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled      boolean;
  v_share        boolean;
  v_delay_hours  integer;
  v_queue_id     uuid;
  v_digits       text;
  v_phone        text;
BEGIN
  IF NEW.type::text NOT IN ('delivery', 'self_delivery')
     OR NEW.status::text <> 'completed'
     OR NEW.deleted_at IS NOT NULL
     OR COALESCE(btrim(NEW.customer_phone), '') = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'completed' THEN
    RETURN NEW;
  END IF;

  -- Store the bare 10-digit number, the same form the kiosk uses, so the
  -- "already reviewed" and "already asked" checks match across both.
  v_digits := regexp_replace(NEW.customer_phone, '\D', '', 'g');
  v_phone  := CASE WHEN length(v_digits) >= 10 THEN right(v_digits, 10)
                   ELSE btrim(NEW.customer_phone) END;

  v_enabled := COALESCE(
    (SELECT lower(btrim(value)) <> 'false' FROM public.app_settings WHERE key = 'delivery_review_enabled'),
    true);
  IF NOT v_enabled THEN
    RETURN NEW;
  END IF;

  v_share := COALESCE(
    (SELECT lower(btrim(value)) <> 'false' FROM public.app_settings WHERE key = 'website_share_enabled'),
    true);
  v_delay_hours := COALESCE(
    NULLIF(regexp_replace(
      COALESCE((SELECT value FROM public.app_settings WHERE key = 'website_share_delay_hours'), ''),
      '\D', '', 'g'), '')::integer,
    48);
  -- Keep the two messages at least 24h apart (one automated message per
  -- customer per day).
  v_delay_hours := GREATEST(v_delay_hours, 24);

  INSERT INTO public.pending_thank_you_messages
    (service_job_id, lead_id, phone, customer_name, message, kind, scheduled_send_time, status)
  VALUES
    (NEW.id, NEW.source_lead_id, v_phone, NEW.customer_name, '',
     'delivery_review', now(), 'pending')
  ON CONFLICT (service_job_id, kind) WHERE service_job_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    -- Already asked for this delivery.
    RETURN NEW;
  END IF;

  IF v_share THEN
    INSERT INTO public.pending_thank_you_messages
      (service_job_id, lead_id, phone, customer_name, message, kind, scheduled_send_time, status)
    VALUES
      (NEW.id, NEW.source_lead_id, v_phone, NEW.customer_name, '',
       'website_share', now() + make_interval(hours => v_delay_hours), 'pending')
    ON CONFLICT (service_job_id, kind) WHERE service_job_id IS NOT NULL DO NOTHING;
  END IF;

  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id', v_queue_id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the field agent from closing a job because a message failed
  -- to queue.
  RAISE WARNING 'delivery review not queued for job %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_delivery_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_service_jobs_delivery_review ON public.service_jobs;
CREATE TRIGGER trg_service_jobs_delivery_review
  AFTER INSERT OR UPDATE OF status ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fn_queue_delivery_review();

-- ── 5. Review confirmed → share the website ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_queue_website_share_after_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_id uuid;
BEGIN
  IF NEW.reviewed_on_google IS NOT TRUE
     OR OLD.reviewed_on_google IS TRUE
     OR COALESCE(btrim(NEW.customer_phone), '') = '' THEN
    RETURN NEW;
  END IF;

  IF NOT COALESCE(
    (SELECT lower(btrim(value)) <> 'false' FROM public.app_settings WHERE key = 'website_share_enabled'),
    true) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pending_thank_you_messages
    (feedback_id, phone, customer_name, message, kind, scheduled_send_time, status)
  VALUES
    (NEW.id, NEW.customer_phone, NEW.customer_name, '', 'website_share', now(), 'pending')
  ON CONFLICT (feedback_id) WHERE kind = 'website_share' AND feedback_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NOT NULL THEN
    PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id', v_queue_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'website share not queued for feedback %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_website_share_after_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_feedback_website_share ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_website_share
  AFTER UPDATE OF reviewed_on_google ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.fn_queue_website_share_after_review();

-- ── 6. Drain schedule ───────────────────────────────────────────────────────
-- The delayed website share only goes out when the drain runs after its
-- scheduled time, so make sure the 5-minute safety-net cron exists.

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'feedback-whatsapp-drain') THEN
    PERFORM cron.schedule(
      'feedback-whatsapp-drain',
      '*/5 * * * *',
      $cron$ SELECT public._invoke_feedback_whatsapp('{}'::jsonb); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;

NOTIFY pgrst, 'reload schema';

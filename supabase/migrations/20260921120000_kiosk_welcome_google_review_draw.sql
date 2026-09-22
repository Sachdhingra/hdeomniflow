-- Kiosk WhatsApp welcome + Google review ask + monthly lucky draw
-- ============================================================================
-- What this adds:
--   1. Settings the welcome message and the draw are driven by.
--   2. review_draw_entries  — one entry per customer per month for the draw.
--   3. monthly_draws        — the draw itself (winner, entry count, status).
--   4. A rewritten thank-you queue that the feedback-whatsapp edge function
--      drains. The message text is now composed by that function (single
--      source of truth in supabase/functions/_shared/kiosk-messages.ts), so
--      the trigger only enqueues and pokes the function via pg_net.
--   5. record_google_review() — kiosk/admin marks a customer as having left a
--      Google review, which also enters them into that month's draw.
--   6. fn_run_monthly_draw() — picks the winner for a month, but only once the
--      month has at least `monthly_draw_min_entries` (default 50) entries.
--      Scheduled daily for the first 7 days of each month; idempotent.
-- ============================================================================

-- ── 1. Settings ─────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value) VALUES
  ('business_name',            'Home Decor Enterprises'),
  ('monthly_draw_enabled',     'true'),
  ('monthly_draw_min_entries', '50'),
  ('monthly_draw_prize',       'a special gift from Home Decor Enterprises'),
  -- Twilio Content (template) SIDs. WhatsApp blocks free text outside the 24h
  -- session window (error 63016), so set these to approved templates once Meta
  -- has approved them. Empty = send as free text.
  -- One per message variant: a one-star visitor must never receive the
  -- review-ask template. Submit them with scripts/submit-whatsapp-templates.mjs.
  --   kiosk_welcome_content_sid   review ask   {{1}} first name, {{2}} review URL
  --   kiosk_feedback_content_sid  plain thanks {{1}} first name
  --   kiosk_recovery_content_sid  1–2 star     {{1}} first name
  --   draw_winner_content_sid     winner       {{1}} first name, {{2}} month, {{3}} prize
  ('kiosk_welcome_content_sid',  ''),
  ('kiosk_feedback_content_sid', ''),
  ('kiosk_recovery_content_sid', ''),
  ('draw_winner_content_sid',    '')
ON CONFLICT (key) DO NOTHING;

-- The kiosk runs signed-out, so it needs to read the draw copy it shows.
DROP POLICY IF EXISTS "Anyone can read public settings" ON public.app_settings;
CREATE POLICY "Anyone can read public settings" ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (key = ANY (ARRAY[
    'google_review_url'::text,
    'business_phone'::text,
    'business_name'::text,
    'monthly_draw_enabled'::text,
    'monthly_draw_min_entries'::text,
    'monthly_draw_prize'::text
  ]));

-- ── 2. Draw entries ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_draw_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_month     date NOT NULL,                      -- first day of the month (IST)
  feedback_id    uuid REFERENCES public.customer_feedback(id) ON DELETE SET NULL,
  customer_name  text NOT NULL,
  customer_phone text NOT NULL,
  source         text NOT NULL DEFAULT 'kiosk',      -- kiosk | admin
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One entry per customer per month — a repeat visitor cannot stuff the draw.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_draw_entry_month_phone
  ON public.review_draw_entries (draw_month, customer_phone);
CREATE INDEX IF NOT EXISTS idx_review_draw_entries_month
  ON public.review_draw_entries (draw_month DESC);

ALTER TABLE public.review_draw_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view draw entries" ON public.review_draw_entries;
CREATE POLICY "Admins view draw entries" ON public.review_draw_entries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage draw entries" ON public.review_draw_entries;
CREATE POLICY "Admins manage draw entries" ON public.review_draw_entries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 3. The draws ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.monthly_draws (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_month           date NOT NULL UNIQUE,         -- month the entries are from
  status               text NOT NULL DEFAULT 'pending', -- pending | completed
  total_entries        integer NOT NULL DEFAULT 0,
  min_entries_required integer NOT NULL DEFAULT 50,
  winner_entry_id      uuid REFERENCES public.review_draw_entries(id) ON DELETE SET NULL,
  winner_name          text,
  winner_phone         text,
  prize                text,
  drawn_at             timestamptz,
  drawn_by             uuid,
  winner_notified_at   timestamptz,
  last_checked_at      timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_draws ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view draws" ON public.monthly_draws;
CREATE POLICY "Admins view draws" ON public.monthly_draws
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage draws" ON public.monthly_draws;
CREATE POLICY "Admins manage draws" ON public.monthly_draws
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_monthly_draws_updated ON public.monthly_draws;
CREATE TRIGGER trg_monthly_draws_updated
  BEFORE UPDATE ON public.monthly_draws
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Outgoing WhatsApp queue ──────────────────────────────────────────────
-- Reused for both the kiosk welcome and the draw-winner announcement. The
-- message body is filled in by the edge function when it sends, so the trigger
-- no longer has to know the wording.

ALTER TABLE public.pending_thank_you_messages
  ADD COLUMN IF NOT EXISTS kind                text NOT NULL DEFAULT 'kiosk_welcome',
  ADD COLUMN IF NOT EXISTS draw_id             uuid REFERENCES public.monthly_draws(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attempts            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at     timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

-- Winner announcements are not tied to a feedback row, and a deleted feedback
-- row should not take its send log with it.
ALTER TABLE public.pending_thank_you_messages
  ALTER COLUMN feedback_id DROP NOT NULL;
ALTER TABLE public.pending_thank_you_messages
  ALTER COLUMN message SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pending_thank_you_pending
  ON public.pending_thank_you_messages (status, scheduled_send_time)
  WHERE status = 'pending';

-- Nothing has ever drained this queue, so every row in it is a message for a
-- visit that is long over. Retire them, or the first run of the new sender
-- would WhatsApp months of old customers at once.
UPDATE public.pending_thank_you_messages
   SET status        = 'cancelled',
       error_message = 'Queued before the kiosk WhatsApp sender existed; not sent retroactively'
 WHERE status = 'pending';

-- ── 5. pg_net dispatch helper ───────────────────────────────────────────────
-- Same shape as public._invoke_staff_push: the shared secret lives in vault or
-- in the app.loyalty_cron_secret database setting, and a failed poke must never
-- abort the write that triggered it (the 5-minute cron picks it up instead).

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
    RAISE WARNING 'kiosk WhatsApp not dispatched: LOYALTY_CRON_SECRET is set in neither vault nor app.loyalty_cron_secret';
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
  RAISE NOTICE 'kiosk WhatsApp dispatch skipped: %', SQLERRM;
  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_feedback_whatsapp(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6. Queue the welcome message the moment feedback is submitted ───────────

CREATE OR REPLACE FUNCTION public.create_thank_you_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_id uuid;
BEGIN
  -- The customer has just typed their name and number at the kiosk, so the
  -- WhatsApp goes out now. feedback-whatsapp composes the text (personalised,
  -- with the Google review ask and the draw explainer) when it sends.
  INSERT INTO public.pending_thank_you_messages
    (feedback_id, phone, message, kind, scheduled_send_time, status)
  VALUES
    (NEW.id, NEW.customer_phone, '', 'kiosk_welcome', now(), 'pending')
  RETURNING id INTO v_queue_id;

  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id', v_queue_id));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_feedback_thank_you ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_thank_you
  AFTER INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.create_thank_you_message();

-- ── 7. Kiosk submit ─────────────────────────────────────────────────────────
-- The kiosk runs signed-out and admins are the only role allowed to SELECT
-- customer_feedback, so a plain insert().select() cannot hand the kiosk back
-- the new row's id. It needs that id to confirm a Google review a moment later,
-- hence this SECURITY DEFINER wrapper.

CREATE OR REPLACE FUNCTION public.submit_kiosk_feedback(
  p_customer_name    text,
  p_customer_phone   text,
  p_overall_rating   smallint,
  p_staff_rating     smallint,
  p_salesperson_name text DEFAULT NULL,
  p_comments         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_phone text := regexp_replace(COALESCE(p_customer_phone, ''), '\D', '', 'g');
  v_id    uuid;
BEGIN
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF v_phone !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'WhatsApp number must be 10 digits';
  END IF;
  IF p_overall_rating IS NULL OR p_overall_rating NOT BETWEEN 1 AND 5
     OR p_staff_rating IS NULL OR p_staff_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Ratings must be between 1 and 5';
  END IF;

  INSERT INTO public.customer_feedback
    (customer_name, customer_phone, overall_rating, staff_rating, salesperson_name, comments)
  VALUES
    (left(v_name, 100), v_phone, p_overall_rating, p_staff_rating,
     NULLIF(btrim(COALESCE(p_salesperson_name, '')), ''),
     NULLIF(btrim(COALESCE(p_comments, '')), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text)
  TO anon, authenticated;

-- ── 8. Recording a Google review (and the draw entry that comes with it) ────

CREATE OR REPLACE FUNCTION public.record_google_review(
  p_feedback_id uuid,
  p_source      text DEFAULT 'kiosk'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fb       public.customer_feedback%ROWTYPE;
  v_is_admin boolean := false;
  v_month    date;
  v_min      integer;
  v_count    integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  END IF;

  SELECT * INTO v_fb FROM public.customer_feedback WHERE id = p_feedback_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found';
  END IF;

  -- The kiosk is signed out, so anyone could call this with a guessed id.
  -- Limit unauthenticated callers to feedback submitted in the last 24 hours —
  -- i.e. the customer standing at the kiosk right now. Admins have no limit,
  -- so they can tick off reviews they spot later on Google.
  IF NOT v_is_admin AND v_fb.created_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'This feedback is too old to confirm a review for';
  END IF;

  v_month := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_min   := COALESCE(
    NULLIF(regexp_replace(
      COALESCE((SELECT value FROM public.app_settings WHERE key = 'monthly_draw_min_entries'), ''),
      '\D', '', 'g'), '')::integer,
    50);

  UPDATE public.customer_feedback
     SET reviewed_on_google = true
   WHERE id = p_feedback_id;

  INSERT INTO public.review_draw_entries
    (draw_month, feedback_id, customer_name, customer_phone, source)
  VALUES
    (v_month, p_feedback_id, v_fb.customer_name, v_fb.customer_phone,
     CASE WHEN v_is_admin AND p_source <> 'kiosk' THEN 'admin' ELSE 'kiosk' END)
  ON CONFLICT (draw_month, customer_phone) DO NOTHING;

  SELECT count(*) INTO v_count
    FROM public.review_draw_entries WHERE draw_month = v_month;

  RETURN jsonb_build_object(
    'draw_month',     v_month,
    'entries',        v_count,
    'min_entries',    v_min,
    'draw_confirmed', v_count >= v_min
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_google_review(uuid, text) TO anon, authenticated;

-- ── 9. Running the draw ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_run_monthly_draw(
  p_month date    DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month    date;
  v_min      integer;
  v_prize    text;
  v_enabled  boolean;
  v_count    integer;
  v_draw     public.monthly_draws%ROWTYPE;
  v_winner   public.review_draw_entries%ROWTYPE;
  v_queue_id uuid;
BEGIN
  -- Manual invocation is limited to admins; pg_cron (no auth context) passes.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Default: the month that just closed, drawn during the first week of this one.
  v_month := COALESCE(
    date_trunc('month', p_month)::date,
    (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date
  );

  v_enabled := COALESCE(
    (SELECT lower(value) = 'true' FROM public.app_settings WHERE key = 'monthly_draw_enabled'),
    true);
  v_min := COALESCE(
    NULLIF(regexp_replace(
      COALESCE((SELECT value FROM public.app_settings WHERE key = 'monthly_draw_min_entries'), ''),
      '\D', '', 'g'), '')::integer,
    50);
  v_prize := COALESCE(
    (SELECT value FROM public.app_settings WHERE key = 'monthly_draw_prize'),
    'a special gift from Home Decor Enterprises');

  SELECT count(*) INTO v_count
    FROM public.review_draw_entries WHERE draw_month = v_month;

  INSERT INTO public.monthly_draws (draw_month, total_entries, min_entries_required, prize, last_checked_at)
  VALUES (v_month, v_count, v_min, v_prize, now())
  ON CONFLICT (draw_month) DO UPDATE
    -- A completed draw keeps the numbers it was actually drawn from, so the
    -- winner's "picked from N entries" never drifts after the fact.
    SET total_entries        = CASE WHEN monthly_draws.status = 'completed'
                                    THEN monthly_draws.total_entries
                                    ELSE EXCLUDED.total_entries END,
        min_entries_required = CASE WHEN monthly_draws.status = 'completed'
                                    THEN monthly_draws.min_entries_required
                                    ELSE EXCLUDED.min_entries_required END,
        last_checked_at      = now()
  RETURNING * INTO v_draw;

  IF v_draw.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ran', false, 'reason', 'already_drawn', 'draw_month', v_month,
      'entries', v_count, 'min_entries', v_min,
      'winner_name', v_draw.winner_name, 'winner_phone', v_draw.winner_phone);
  END IF;

  IF NOT v_enabled AND NOT p_force THEN
    RETURN jsonb_build_object(
      'ran', false, 'reason', 'draw_disabled', 'draw_month', v_month,
      'entries', v_count, 'min_entries', v_min);
  END IF;

  -- The rule the customers are told about: no draw below the entry threshold.
  IF v_count < v_min AND NOT p_force THEN
    RETURN jsonb_build_object(
      'ran', false, 'reason', 'insufficient_entries', 'draw_month', v_month,
      'entries', v_count, 'min_entries', v_min);
  END IF;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'ran', false, 'reason', 'no_entries', 'draw_month', v_month,
      'entries', 0, 'min_entries', v_min);
  END IF;

  SELECT * INTO v_winner
    FROM public.review_draw_entries
   WHERE draw_month = v_month
   ORDER BY random()
   LIMIT 1;

  UPDATE public.monthly_draws
     SET status          = 'completed',
         winner_entry_id = v_winner.id,
         winner_name     = v_winner.customer_name,
         winner_phone    = v_winner.customer_phone,
         prize           = v_prize,
         drawn_at        = now(),
         drawn_by        = auth.uid(),
         notes           = CASE WHEN p_force AND v_count < v_min
                                THEN 'Drawn manually below the ' || v_min || '-entry threshold'
                                ELSE NULL END
   WHERE id = v_draw.id
  RETURNING * INTO v_draw;

  -- Tell the winner on WhatsApp.
  INSERT INTO public.pending_thank_you_messages
    (feedback_id, phone, message, kind, draw_id, scheduled_send_time, status)
  VALUES
    (v_winner.feedback_id, v_winner.customer_phone, '', 'draw_winner', v_draw.id, now(), 'pending')
  RETURNING id INTO v_queue_id;

  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id', v_queue_id));

  RETURN jsonb_build_object(
    'ran', true, 'draw_month', v_month, 'entries', v_count, 'min_entries', v_min,
    'winner_name', v_winner.customer_name, 'winner_phone', v_winner.customer_phone,
    'forced', p_force AND v_count < v_min);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_run_monthly_draw(date, boolean) TO authenticated;

-- Re-send the winner announcement (admin button on the feedback dashboard).
CREATE OR REPLACE FUNCTION public.fn_resend_draw_winner_message(p_draw_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw     public.monthly_draws%ROWTYPE;
  v_queue_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_draw FROM public.monthly_draws WHERE id = p_draw_id;
  IF NOT FOUND OR v_draw.status <> 'completed' OR v_draw.winner_phone IS NULL THEN
    RAISE EXCEPTION 'No winner to message for this draw';
  END IF;

  INSERT INTO public.pending_thank_you_messages
    (feedback_id, phone, message, kind, draw_id, scheduled_send_time, status)
  VALUES
    ((SELECT feedback_id FROM public.review_draw_entries WHERE id = v_draw.winner_entry_id),
     v_draw.winner_phone, '', 'draw_winner', v_draw.id, now(), 'pending')
  RETURNING id INTO v_queue_id;

  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id', v_queue_id));

  RETURN jsonb_build_object('queued', true, 'queue_id', v_queue_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_resend_draw_winner_message(uuid) TO authenticated;

-- Monthly entry counts for the admin dashboard (admins only).
CREATE OR REPLACE FUNCTION public.fn_monthly_draw_entry_counts()
RETURNS TABLE (draw_month date, entries bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
    SELECT e.draw_month, count(*)::bigint
      FROM public.review_draw_entries e
     GROUP BY e.draw_month
     ORDER BY e.draw_month DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_monthly_draw_entry_counts() TO authenticated;

-- ── 10. Schedules ────────────────────────────────────────────────────────────

DO $do$
BEGIN
  -- Safety net for the instant pg_net poke: drain anything still pending.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'feedback-whatsapp-drain') THEN
    PERFORM cron.unschedule('feedback-whatsapp-drain');
  END IF;
  PERFORM cron.schedule(
    'feedback-whatsapp-drain',
    '*/5 * * * *',
    $cron$ SELECT public._invoke_feedback_whatsapp('{}'::jsonb); $cron$
  );

  -- First week of every month, 10:00 IST (04:30 UTC). Idempotent: the first run
  -- that clears the entry threshold draws the winner, later runs no-op.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-review-draw') THEN
    PERFORM cron.unschedule('monthly-review-draw');
  END IF;
  PERFORM cron.schedule(
    'monthly-review-draw',
    '30 4 1-7 * *',
    $cron$ SELECT public.fn_run_monthly_draw(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron / pg_net may not be available in local dev; skip silently.
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;

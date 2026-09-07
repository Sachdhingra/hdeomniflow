ALTER TABLE public.push_notifications_log
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS offer_code text,
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.push_campaigns(id) ON DELETE SET NULL;

UPDATE public.push_notifications_log
SET expires_at = sent_at + interval '24 hours'
WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS push_notifications_log_customer_sent_idx
  ON public.push_notifications_log (customer_id, sent_at DESC);

GRANT SELECT, UPDATE ON public.push_notifications_log TO authenticated;
GRANT ALL ON public.push_notifications_log TO service_role;

DROP POLICY IF EXISTS pnl_customer_recent_select ON public.push_notifications_log;
CREATE POLICY pnl_customer_recent_select
  ON public.push_notifications_log
  FOR SELECT
  TO authenticated
  USING (
    customer_id = public.get_loyalty_customer_id(auth.uid())
    AND sent_at > now() - interval '24 hours'
  );

DROP POLICY IF EXISTS pnl_customer_mark_opened ON public.push_notifications_log;
CREATE POLICY pnl_customer_mark_opened
  ON public.push_notifications_log
  FOR UPDATE
  TO authenticated
  USING (
    customer_id = public.get_loyalty_customer_id(auth.uid())
    AND sent_at > now() - interval '24 hours'
  )
  WITH CHECK (
    customer_id = public.get_loyalty_customer_id(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.guard_push_log_customer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / staff paths bypass this guard.
  IF auth.uid() IS NULL OR public.get_loyalty_customer_id(auth.uid()) IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.image_url IS DISTINCT FROM OLD.image_url
     OR NEW.link_url IS DISTINCT FROM OLD.link_url
     OR NEW.offer_code IS DISTINCT FROM OLD.offer_code
     OR NEW.offer_expires_at IS DISTINCT FROM OLD.offer_expires_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id
  THEN
    RAISE EXCEPTION 'Only the opened status can be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_push_log_customer_update ON public.push_notifications_log;
CREATE TRIGGER trg_guard_push_log_customer_update
  BEFORE UPDATE ON public.push_notifications_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_push_log_customer_update();
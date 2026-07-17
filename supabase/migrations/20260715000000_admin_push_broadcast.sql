-- Admin Push Notifications — Insider app broadcast + automation toggles
--
-- 1. push_campaigns            : admin-composed broadcast pushes (text / banner / offer)
-- 2. push_automation_settings  : admin on/off switches for the automated loyalty
--                                reminders sent by the loyalty-cron edge function
-- 3. push_notifications_log    : add delivery_status column (send-push already
--                                writes it but the original schema never added it)

-- ============================================================
-- 1. push_notifications_log.delivery_status
-- ============================================================
ALTER TABLE public.push_notifications_log
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent';

-- ============================================================
-- 2. push_campaigns
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_campaigns (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type       TEXT        NOT NULL DEFAULT 'text'
                                  CHECK (campaign_type IN ('text', 'banner', 'offer')),
  title               TEXT        NOT NULL,
  message             TEXT        NOT NULL,
  image_url           TEXT,
  link_url            TEXT,
  offer_code          TEXT,
  offer_expires_at    TIMESTAMPTZ,
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  recipients_targeted INTEGER     NOT NULL DEFAULT 0,
  recipients_sent     INTEGER     NOT NULL DEFAULT 0,
  error               TEXT,
  created_by          UUID        REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.push_campaigns TO authenticated;
GRANT ALL ON public.push_campaigns TO service_role;

CREATE INDEX IF NOT EXISTS idx_push_campaigns_created ON public.push_campaigns(created_at DESC);

DROP POLICY IF EXISTS "push_campaigns_admin_all" ON public.push_campaigns;
CREATE POLICY "push_campaigns_admin_all" ON public.push_campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3. push_automation_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_automation_settings (
  key         TEXT        PRIMARY KEY,
  label       TEXT        NOT NULL,
  description TEXT,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID        REFERENCES auth.users(id)
);

ALTER TABLE public.push_automation_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.push_automation_settings TO authenticated;
GRANT ALL ON public.push_automation_settings TO service_role;

DROP POLICY IF EXISTS "push_automation_admin_all" ON public.push_automation_settings;
CREATE POLICY "push_automation_admin_all" ON public.push_automation_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.push_automation_settings (key, label, description) VALUES
  ('points_balance',    'Redemption reminder (existing points)',
   'Monthly nudge to customers who have unredeemed loyalty points on their card'),
  ('points_expiring',   'Points expiry reminder',
   'Sent 30 and 7 days before loyalty points expire'),
  ('card_expiring',     'Card expiry reminder',
   'Sent 60 and 30 days before the Elite Card expires'),
  ('birthday',          'Birthday message',
   'Birthday greeting sent to customers on their date of birth'),
  ('anniversary_bonus', 'Anniversary bonus message',
   'Notifies customers when their card-anniversary bonus points are credited'),
  ('dormant',           'We-miss-you reminder',
   'Sent to customers with no purchase in the last 180 days (max once per 30 days)')
ON CONFLICT (key) DO NOTHING;

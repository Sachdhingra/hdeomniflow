-- Push notifications across all apps
--
-- Until now only the Insider customer PWA could receive real web push; the
-- OmniFlow staff app relied on Notification.showNotification() driven by a
-- live realtime subscription, so alerts stopped the moment the app was
-- closed. This migration adds the pieces needed for push to work at all
-- times on both apps, routed through the OmniFlow dashboard:
--
--   1. staff_push_devices        : OneSignal subscriptions for staff devices
--   2. app_users push columns    : track the browser permission state so the
--                                  dashboard can see who still needs to opt in
--   3. push_campaigns.audience   : broadcasts can target customers or staff
--   4. push_notifications_log    : log staff sends alongside customer sends
--   5. reengagement automation   : admin switch for the "turn notifications
--                                  back on" nudge to existing app users
--   6. notification/chat triggers: fire send-staff-push server-side so staff
--                                  pushes no longer depend on an open tab

-- ============================================================
-- 1. staff_push_devices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.staff_push_devices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  onesignal_player_id TEXT        NOT NULL UNIQUE,
  role                TEXT,
  push_enabled        BOOLEAN     NOT NULL DEFAULT true,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_push_devices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_push_devices TO authenticated;
GRANT ALL ON public.staff_push_devices TO service_role;

CREATE INDEX IF NOT EXISTS idx_staff_push_devices_user ON public.staff_push_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_push_devices_enabled
  ON public.staff_push_devices(push_enabled) WHERE push_enabled;

-- A staff member manages their own devices; admins can see them all so the
-- dashboard can report reach.
DROP POLICY IF EXISTS "staff_push_devices_own" ON public.staff_push_devices;
CREATE POLICY "staff_push_devices_own" ON public.staff_push_devices
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

-- Registering a device goes through this RPC rather than a direct upsert.
-- On a shared browser the OneSignal subscription ID stays the same when a
-- second staff member signs in, and RLS would block them from taking over the
-- existing row — leaving their alerts routed to whoever registered first.
CREATE OR REPLACE FUNCTION public.register_staff_push_device(
  _player_id  text,
  _role       text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF COALESCE(TRIM(_player_id), '') = '' THEN
    RAISE EXCEPTION 'player id required';
  END IF;

  INSERT INTO public.staff_push_devices AS d
    (user_id, onesignal_player_id, role, push_enabled, user_agent, last_seen_at)
  VALUES
    (auth.uid(), _player_id, _role, true, LEFT(COALESCE(_user_agent, ''), 300), now())
  ON CONFLICT (onesignal_player_id) DO UPDATE
    SET user_id      = auth.uid(),
        role         = COALESCE(EXCLUDED.role, d.role),
        push_enabled = true,
        user_agent   = EXCLUDED.user_agent,
        last_seen_at = now();
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.register_staff_push_device(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.register_staff_push_device(text, text, text) TO authenticated;

-- ============================================================
-- 2. app_users — permission tracking for the Insider app
-- ============================================================
-- push_enabled already defaults to true (promotional opt-in). These columns
-- record what the *browser* actually granted, which is the part that silently
-- blocks delivery for customers who installed before the prompt existed.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS push_permission          TEXT,
  ADD COLUMN IF NOT EXISTS push_permission_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_prompt_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_reengaged_at        TIMESTAMPTZ;

COMMENT ON COLUMN public.app_users.push_permission IS
  'Last known browser Notification.permission for this customer: granted | denied | default.';
COMMENT ON COLUMN public.app_users.push_prompt_dismissed_at IS
  'When the customer dismissed the in-app "turn on notifications" banner. Re-shown after 7 days.';
COMMENT ON COLUMN public.app_users.push_reengaged_at IS
  'When this customer was last sent the re-engagement nudge to switch notifications on.';

CREATE INDEX IF NOT EXISTS idx_app_users_push_permission ON public.app_users(push_permission);

-- ============================================================
-- 3. push_campaigns.audience
-- ============================================================
ALTER TABLE public.push_campaigns
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'customers';

DO $$
BEGIN
  ALTER TABLE public.push_campaigns
    ADD CONSTRAINT push_campaigns_audience_check
    CHECK (audience IN ('customers', 'staff'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- 'reengagement' joins text/banner/offer as a campaign type so the nudge shows
-- up in the campaign history with its own label.
ALTER TABLE public.push_campaigns DROP CONSTRAINT IF EXISTS push_campaigns_campaign_type_check;
ALTER TABLE public.push_campaigns
  ADD CONSTRAINT push_campaigns_campaign_type_check
  CHECK (campaign_type IN ('text', 'banner', 'offer', 'reengagement'));

-- ============================================================
-- 4. push_notifications_log — staff sends
-- ============================================================
-- customer_id stays for Insider sends; staff sends carry staff_user_id instead.
ALTER TABLE public.push_notifications_log
  ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_push_log_staff ON public.push_notifications_log(staff_user_id);

-- ============================================================
-- 5. reengagement automation switch
-- ============================================================
INSERT INTO public.push_automation_settings (key, label, description) VALUES
  ('reengagement', 'Turn-notifications-back-on nudge',
   'Reminds existing app customers whose notifications are off to switch them back on. Promotional: sent to already-subscribed devices; everyone else sees the in-app banner.'),
  ('staff_alerts', 'Staff app push alerts',
   'Delivers chat messages, lead assignments and order updates to the OmniFlow staff app as push, so they arrive when the app is closed.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 6. Server-side staff push dispatch
-- ============================================================
-- Staff push must not depend on a browser tab being open, so the dispatch runs
-- from the database. Mirrors the daily-report pattern: a SECURITY DEFINER
-- helper reads the shared secret from vault and posts to the edge function.
CREATE OR REPLACE FUNCTION public._invoke_staff_push(_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $fn$
DECLARE
  v_secret     text;
  v_request_id bigint;
BEGIN
  -- The shared secret lives in one of two places depending on how the
  -- project was set up: vault (the daily-report pattern) or the
  -- app.loyalty_cron_secret database setting (what loyalty-cron uses).
  -- Try both, since either can be the configured one. Whichever holds it
  -- must match the LOYALTY_CRON_SECRET edge-function env var, or
  -- send-staff-push will reject the call with 401.
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'LOYALTY_CRON_SECRET'
  LIMIT 1;

  IF COALESCE(v_secret, '') = '' THEN
    v_secret := current_setting('app.loyalty_cron_secret', true);
  END IF;

  IF COALESCE(v_secret, '') = '' THEN
    RAISE WARNING 'staff push not dispatched: LOYALTY_CRON_SECRET is set in neither vault nor app.loyalty_cron_secret';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/send-staff-push',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := _payload
  ) INTO v_request_id;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let a failed push abort the write that triggered it.
  RAISE NOTICE 'staff push dispatch skipped: %', SQLERRM;
  RETURN NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_staff_push(jsonb) FROM PUBLIC, anon, authenticated;

-- Honour the admin's staff_alerts switch before dispatching.
CREATE OR REPLACE FUNCTION public._staff_push_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT enabled FROM public.push_automation_settings WHERE key = 'staff_alerts'),
    true
  );
$fn$;

-- ---- notifications → push -------------------------------------------------
-- Every staff-facing alert in the app already lands in public.notifications,
-- so one trigger here covers lead assignments, service jobs and order updates.
CREATE OR REPLACE FUNCTION public.fn_notification_staff_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT public._staff_push_enabled() THEN
    RETURN NEW;
  END IF;

  PERFORM public._invoke_staff_push(jsonb_build_object(
    'user_ids', jsonb_build_array(NEW.user_id),
    'type',     COALESCE(NEW.type, 'info'),
    -- Mirrors ORDER_TYPES / LeadNotifier in the app so a push and an in-app
    -- toast for the same event read identically.
    'title',    CASE COALESCE(NEW.type, 'info')
                  WHEN 'lead_assigned'             THEN '🎯 New Lead Assigned'
                  WHEN 'order_approval'            THEN '🧾 Order Awaiting Approval'
                  WHEN 'order_service'             THEN '🔧 Order Ready for Service'
                  WHEN 'order_rejected'            THEN '❌ Order Rejected'
                  WHEN 'order_approval_reminder'   THEN '⏰ Approval Pending Reminder'
                  WHEN 'order_service_reminder'    THEN '⏰ Service Pending Reminder'
                  WHEN 'order_reminder'            THEN '⏰ Open Order Reminder'
                  ELSE 'OmniFlow'
                END,
    'message',  NEW.message,
    'data',     jsonb_build_object('url', COALESCE(NEW.link, '/'), 'notification_id', NEW.id)
  ));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notification_staff_push ON public.notifications;
CREATE TRIGGER trg_notification_staff_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.fn_notification_staff_push();

-- ---- chat_messages → push -------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_chat_message_staff_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_recipients uuid[];
  v_sender     text;
  v_channel    text;
  v_body       text;
BEGIN
  IF NOT public._staff_push_enabled() THEN
    RETURN NEW;
  END IF;

  -- Deleted-on-arrival or empty messages carry nothing worth pushing.
  IF NEW.deleted_at IS NOT NULL OR COALESCE(TRIM(NEW.body), '') = '' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(user_id) INTO v_recipients
  FROM public.chat_channel_members
  WHERE channel_id = NEW.channel_id
    AND user_id <> NEW.sender_id;

  IF v_recipients IS NULL OR array_length(v_recipients, 1) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_sender  FROM public.profiles      WHERE id = NEW.sender_id;
  SELECT name INTO v_channel FROM public.chat_channels  WHERE id = NEW.channel_id;

  -- Keep the shade preview short; the full message is in the app.
  v_body := LEFT(NEW.body, 140);

  PERFORM public._invoke_staff_push(jsonb_build_object(
    'user_ids', to_jsonb(v_recipients),
    'type',     'chat_message',
    'title',    COALESCE(v_sender, 'New message')
                || CASE WHEN v_channel IS NULL THEN '' ELSE ' · ' || v_channel END,
    'message',  v_body,
    'data',     jsonb_build_object('url', '/chat', 'channel_id', NEW.channel_id)
  ));

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_chat_message_staff_push ON public.chat_messages;
CREATE TRIGGER trg_chat_message_staff_push
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_chat_message_staff_push();
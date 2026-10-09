-- Staff agent (sales pilot): a per-person coach that checks in every 2 hours
-- during working hours (11:00-20:00 IST) and chats with staff who are present.
--
-- Messages live in one table so the full conversation is auditable and the
-- app can render it with realtime. Staff read only their own thread; writes go
-- through the staff-agent edge function (service role), which enforces the
-- attendance gate server-side.

CREATE TABLE IF NOT EXISTS public.staff_agent_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_role text NOT NULL DEFAULT 'sales',
  sender     text NOT NULL CHECK (sender IN ('agent','staff')),
  kind       text NOT NULL CHECK (kind IN ('checkin','reply','system')),
  content    text NOT NULL,
  -- Start of the 2-hourly slot a check-in belongs to; makes ticks idempotent.
  slot_at    timestamptz,
  -- Actions the agent applied to leads from a reply (audit trail).
  actions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_agent_messages_user
  ON public.staff_agent_messages(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_agent_checkin_slot
  ON public.staff_agent_messages(user_id, slot_at)
  WHERE kind = 'checkin';

ALTER TABLE public.staff_agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_agent_msgs_own_select ON public.staff_agent_messages;
CREATE POLICY staff_agent_msgs_own_select ON public.staff_agent_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS staff_agent_msgs_admin_select ON public.staff_agent_messages;
CREATE POLICY staff_agent_msgs_admin_select ON public.staff_agent_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Staff may only mark their own messages read.
DROP POLICY IF EXISTS staff_agent_msgs_own_update ON public.staff_agent_messages;
CREATE POLICY staff_agent_msgs_own_update ON public.staff_agent_messages
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_agent_messages;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication skipped: %', SQLERRM;
END;
$$;

-- Dispatch helper, same pattern as _invoke_loyalty_cron.
CREATE OR REPLACE FUNCTION public._invoke_staff_agent_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $fn$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  v_url := current_setting('app.supabase_functions_url', true);
  IF COALESCE(v_url, '') = '' THEN
    v_url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1';
  END IF;

  v_secret := current_setting('app.loyalty_cron_secret', true);
  IF COALESCE(v_secret, '') = '' THEN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'LOYALTY_CRON_SECRET'
    LIMIT 1;
  END IF;

  IF COALESCE(v_secret, '') = '' THEN
    RAISE WARNING 'staff-agent tick not dispatched: LOYALTY_CRON_SECRET is set in neither app.loyalty_cron_secret nor vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/staff-agent',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := '{"action":"tick"}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_staff_agent_tick() FROM PUBLIC, anon, authenticated;

-- 11:30, 13:30, 15:30, 17:30, 19:30 IST = 06:00, 08:00, 10:00, 12:00, 14:00 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'staff-agent-tick') THEN
    PERFORM cron.unschedule('staff-agent-tick');
  END IF;

  PERFORM cron.schedule(
    'staff-agent-tick',
    '0 6,8,10,12,14 * * *',
    $$ SELECT public._invoke_staff_agent_tick(); $$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$$;

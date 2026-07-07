-- External Attack Protection
-- Brute-force login throttling, security event logging, and function hardening

-- ============================================================
-- 1. Security events table (attack telemetry)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,        -- 'login_failed' | 'login_locked' | 'rate_limited'
                                   -- | 'suspicious_input' | 'session_expired'
                                   -- | 'unauthorized_access' | 'integrity_violation'
  severity TEXT NOT NULL DEFAULT 'low',  -- 'low' | 'medium' | 'high' | 'critical'
  user_id UUID,                    -- NULL for pre-auth events (failed logins)
  identifier TEXT,                 -- username/email/IP being targeted
  details JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Only admin can read security events
CREATE POLICY security_events_admin_select ON public.security_events
  FOR SELECT TO authenticated
  USING (public.get_user_role(auth.uid()) = 'admin');

-- No direct INSERT/UPDATE/DELETE from clients; writes go through
-- the SECURITY DEFINER functions below only.

CREATE INDEX IF NOT EXISTS idx_security_events_type_time
  ON public.security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_identifier
  ON public.security_events(identifier, created_at DESC);

-- ============================================================
-- 2. Login attempt tracking + rate limiting (brute-force guard)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,        -- normalized username/email
  success BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- No client access at all; only SECURITY DEFINER functions touch this table.

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_time
  ON public.login_attempts(identifier, attempted_at DESC);

-- Check whether login is allowed for an identifier.
-- Policy: max 5 failed attempts per 15 minutes -> locked for 15 minutes.
-- Callable by anon (runs BEFORE authentication).
CREATE OR REPLACE FUNCTION public.check_login_allowed(_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed_count INT;
  v_oldest_relevant TIMESTAMPTZ;
  v_retry_after_seconds INT;
BEGIN
  SELECT count(*), min(attempted_at)
  INTO v_failed_count, v_oldest_relevant
  FROM public.login_attempts
  WHERE identifier = lower(trim(_identifier))
    AND success = false
    AND attempted_at > now() - interval '15 minutes';

  IF v_failed_count >= 5 THEN
    v_retry_after_seconds :=
      GREATEST(0, EXTRACT(EPOCH FROM (v_oldest_relevant + interval '15 minutes' - now()))::INT);

    INSERT INTO public.security_events (event_type, severity, identifier, details)
    VALUES ('login_locked', 'high', lower(trim(_identifier)),
            jsonb_build_object('failed_count', v_failed_count,
                               'retry_after_seconds', v_retry_after_seconds));

    RETURN jsonb_build_object('allowed', false,
                              'retry_after_seconds', v_retry_after_seconds);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'failed_count', v_failed_count);
END;
$$;

-- Record a login attempt outcome. Callable by anon.
CREATE OR REPLACE FUNCTION public.record_login_attempt(_identifier TEXT, _success BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.login_attempts (identifier, success)
  VALUES (lower(trim(_identifier)), _success);

  IF _success THEN
    -- Successful login clears the failure window for this identifier
    DELETE FROM public.login_attempts
    WHERE identifier = lower(trim(_identifier)) AND success = false;
  ELSE
    INSERT INTO public.security_events (event_type, severity, identifier)
    VALUES ('login_failed', 'medium', lower(trim(_identifier)));
  END IF;

  -- Opportunistic cleanup of attempts older than 24h
  DELETE FROM public.login_attempts WHERE attempted_at < now() - interval '24 hours';
END;
$$;

-- Client-reported security event (authenticated users only; capped severity
-- so clients can't spoof 'critical' alerts, and rate-limited per user).
CREATE OR REPLACE FUNCTION public.log_security_event(
  _event_type TEXT,
  _details JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Rate limit: max 30 client-reported events per user per hour
  SELECT count(*) INTO v_recent_count
  FROM public.security_events
  WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 30 THEN
    RETURN;  -- silently drop to prevent log-flooding attacks
  END IF;

  INSERT INTO public.security_events (event_type, severity, user_id, details)
  VALUES (
    CASE WHEN _event_type IN ('suspicious_input', 'session_expired',
                              'unauthorized_access', 'integrity_violation')
         THEN _event_type ELSE 'client_reported' END,
    'medium',
    auth.uid(),
    _details
  );
END;
$$;

-- ============================================================
-- 3. Grants — deny by default, allow only what's needed
-- ============================================================
REVOKE ALL ON TABLE public.security_events FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.login_attempts FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.security_events TO authenticated;  -- RLS restricts to admin

REVOKE ALL ON FUNCTION public.check_login_allowed(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.record_login_attempt(TEXT, BOOLEAN) FROM public;
REVOKE ALL ON FUNCTION public.log_security_event(TEXT, JSONB) FROM public;

GRANT EXECUTE ON FUNCTION public.check_login_allowed(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(TEXT, JSONB) TO authenticated;

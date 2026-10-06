ALTER TABLE public.pending_thank_you_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'kiosk_welcome',
  ADD COLUMN IF NOT EXISTS draw_id uuid,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE public.pending_thank_you_messages ALTER COLUMN feedback_id DROP NOT NULL;
ALTER TABLE public.pending_thank_you_messages ALTER COLUMN message SET DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_pending_thank_you_pending ON public.pending_thank_you_messages(status, scheduled_send_time) WHERE status = 'pending';
GRANT ALL ON public.pending_thank_you_messages TO service_role;

CREATE TABLE IF NOT EXISTS public.monthly_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_month date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  total_entries integer NOT NULL DEFAULT 0,
  min_entries_required integer NOT NULL DEFAULT 50,
  winner_entry_id uuid REFERENCES public.review_draw_entries(id) ON DELETE SET NULL,
  winner_name text,
  winner_phone text,
  prize text,
  drawn_at timestamptz,
  drawn_by uuid,
  winner_notified_at timestamptz,
  last_checked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_draws TO authenticated;
GRANT ALL ON public.monthly_draws TO service_role;
ALTER TABLE public.monthly_draws ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view draws" ON public.monthly_draws;
CREATE POLICY "Admins view draws" ON public.monthly_draws FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins manage draws" ON public.monthly_draws;
CREATE POLICY "Admins manage draws" ON public.monthly_draws FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_monthly_draws_month ON public.monthly_draws(draw_month DESC);
DROP TRIGGER IF EXISTS trg_monthly_draws_updated ON public.monthly_draws;
CREATE TRIGGER trg_monthly_draws_updated BEFORE UPDATE ON public.monthly_draws FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pending_thank_you_messages_draw_id_fkey') THEN
    ALTER TABLE public.pending_thank_you_messages ADD CONSTRAINT pending_thank_you_messages_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES public.monthly_draws(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._invoke_feedback_whatsapp(_payload jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault AS $fn$
DECLARE v_secret text; v_base text; v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='LOYALTY_CRON_SECRET' LIMIT 1;
  IF COALESCE(v_secret,'')='' THEN v_secret := current_setting('app.loyalty_cron_secret', true); END IF;
  IF COALESCE(v_secret,'')='' THEN RAISE WARNING 'feedback WhatsApp not dispatched: internal secret unavailable'; RETURN NULL; END IF;
  v_base := COALESCE(current_setting('app.supabase_functions_url', true), 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1');
  SELECT net.http_post(url:=v_base||'/feedback-whatsapp', headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',v_secret), body:=COALESCE(_payload,'{}'::jsonb)) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'feedback WhatsApp dispatch skipped: %', SQLERRM; RETURN NULL;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public._invoke_feedback_whatsapp(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._invoke_feedback_whatsapp(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_thank_you_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_queue_id uuid;
BEGIN
  INSERT INTO public.pending_thank_you_messages(feedback_id,phone,message,kind,scheduled_send_time,status)
  VALUES(NEW.id,NEW.customer_phone,'','kiosk_welcome',now(),'pending') RETURNING id INTO v_queue_id;
  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id',v_queue_id));
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_run_monthly_draw(p_month date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_month date; v_min integer; v_prize text; v_enabled boolean; v_count integer; v_draw public.monthly_draws%ROWTYPE; v_winner public.review_draw_entries%ROWTYPE; v_queue_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  v_month:=COALESCE(date_trunc('month',p_month)::date,(date_trunc('month',(now() AT TIME ZONE 'Asia/Kolkata'))-interval '1 month')::date);
  v_enabled:=COALESCE((SELECT lower(value)='true' FROM public.app_settings WHERE key='monthly_draw_enabled'),true);
  v_min:=COALESCE(NULLIF(regexp_replace(COALESCE((SELECT value FROM public.app_settings WHERE key='monthly_draw_min_entries'),''),'\D','','g'),'')::integer,50);
  v_prize:=COALESCE((SELECT value FROM public.app_settings WHERE key='monthly_draw_prize'),'a special gift from Home Decor Enterprises');
  SELECT count(*) INTO v_count FROM public.review_draw_entries WHERE draw_month=v_month;
  INSERT INTO public.monthly_draws(draw_month,total_entries,min_entries_required,prize,last_checked_at) VALUES(v_month,v_count,v_min,v_prize,now())
  ON CONFLICT(draw_month) DO UPDATE SET total_entries=CASE WHEN monthly_draws.status='completed' THEN monthly_draws.total_entries ELSE EXCLUDED.total_entries END,min_entries_required=CASE WHEN monthly_draws.status='completed' THEN monthly_draws.min_entries_required ELSE EXCLUDED.min_entries_required END,last_checked_at=now() RETURNING * INTO v_draw;
  IF v_draw.status='completed' THEN RETURN jsonb_build_object('ran',false,'reason','already_drawn','draw_month',v_month,'entries',v_count,'min_entries',v_min,'winner_name',v_draw.winner_name,'winner_phone',v_draw.winner_phone); END IF;
  IF NOT v_enabled AND NOT p_force THEN RETURN jsonb_build_object('ran',false,'reason','draw_disabled','draw_month',v_month,'entries',v_count,'min_entries',v_min); END IF;
  IF v_count<v_min AND NOT p_force THEN RETURN jsonb_build_object('ran',false,'reason','insufficient_entries','draw_month',v_month,'entries',v_count,'min_entries',v_min); END IF;
  IF v_count=0 THEN RETURN jsonb_build_object('ran',false,'reason','no_entries','draw_month',v_month,'entries',0,'min_entries',v_min); END IF;
  SELECT * INTO v_winner FROM public.review_draw_entries WHERE draw_month=v_month ORDER BY random() LIMIT 1;
  UPDATE public.monthly_draws SET status='completed',winner_entry_id=v_winner.id,winner_name=v_winner.customer_name,winner_phone=v_winner.customer_phone,prize=v_prize,drawn_at=now(),drawn_by=auth.uid(),notes=CASE WHEN p_force AND v_count<v_min THEN 'Drawn manually below the '||v_min||'-entry threshold' END WHERE id=v_draw.id RETURNING * INTO v_draw;
  INSERT INTO public.pending_thank_you_messages(feedback_id,phone,message,kind,draw_id,scheduled_send_time,status) VALUES(v_winner.feedback_id,v_winner.customer_phone,'','draw_winner',v_draw.id,now(),'pending') RETURNING id INTO v_queue_id;
  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id',v_queue_id));
  RETURN jsonb_build_object('ran',true,'draw_month',v_month,'entries',v_count,'min_entries',v_min,'winner_name',v_winner.customer_name,'winner_phone',v_winner.customer_phone,'forced',p_force AND v_count<v_min);
END; $$;
REVOKE EXECUTE ON FUNCTION public.fn_run_monthly_draw(date,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_run_monthly_draw(date,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_resend_draw_winner_message(p_draw_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_draw public.monthly_draws%ROWTYPE; v_queue_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO v_draw FROM public.monthly_draws WHERE id=p_draw_id;
  IF NOT FOUND OR v_draw.status<>'completed' OR v_draw.winner_phone IS NULL THEN RAISE EXCEPTION 'No winner to message for this draw'; END IF;
  INSERT INTO public.pending_thank_you_messages(feedback_id,phone,message,kind,draw_id,scheduled_send_time,status) VALUES((SELECT feedback_id FROM public.review_draw_entries WHERE id=v_draw.winner_entry_id),v_draw.winner_phone,'','draw_winner',v_draw.id,now(),'pending') RETURNING id INTO v_queue_id;
  PERFORM public._invoke_feedback_whatsapp(jsonb_build_object('queue_id',v_queue_id));
  RETURN jsonb_build_object('queued',true,'queue_id',v_queue_id);
END; $$;
REVOKE EXECUTE ON FUNCTION public.fn_resend_draw_winner_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_resend_draw_winner_message(uuid) TO authenticated, service_role;
-- Approval-aware rating templates are configured through app_settings data.

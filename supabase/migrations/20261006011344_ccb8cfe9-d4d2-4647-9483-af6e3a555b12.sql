ALTER FUNCTION public.fn_run_monthly_draw(date, boolean) SECURITY INVOKER;
ALTER FUNCTION public.fn_resend_draw_winner_message(uuid) SECURITY INVOKER;
GRANT SELECT ON public.review_draw_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.monthly_draws TO authenticated;
GRANT SELECT, INSERT ON public.pending_thank_you_messages TO authenticated;
DROP POLICY IF EXISTS "Admins enqueue review messages" ON public.pending_thank_you_messages;
CREATE POLICY "Admins enqueue review messages" ON public.pending_thank_you_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.fn_run_monthly_draw(p_month date DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_month date; v_min integer; v_prize text; v_enabled boolean; v_count integer; v_draw public.monthly_draws%ROWTYPE; v_winner public.review_draw_entries%ROWTYPE; v_queue_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Not authorized'; END IF;
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
  RETURN jsonb_build_object('ran',true,'draw_month',v_month,'entries',v_count,'min_entries',v_min,'winner_name',v_winner.customer_name,'winner_phone',v_winner.customer_phone,'forced',p_force AND v_count<v_min,'queued',true);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_resend_draw_winner_message(p_draw_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_draw public.monthly_draws%ROWTYPE; v_queue_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO v_draw FROM public.monthly_draws WHERE id=p_draw_id;
  IF NOT FOUND OR v_draw.status<>'completed' OR v_draw.winner_phone IS NULL THEN RAISE EXCEPTION 'No winner to message for this draw'; END IF;
  INSERT INTO public.pending_thank_you_messages(feedback_id,phone,message,kind,draw_id,scheduled_send_time,status) VALUES((SELECT feedback_id FROM public.review_draw_entries WHERE id=v_draw.winner_entry_id),v_draw.winner_phone,'','draw_winner',v_draw.id,now(),'pending') RETURNING id INTO v_queue_id;
  RETURN jsonb_build_object('queued',true,'queue_id',v_queue_id);
END; $$;
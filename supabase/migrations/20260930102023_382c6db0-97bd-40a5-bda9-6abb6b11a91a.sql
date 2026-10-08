DROP TRIGGER trg_track_lead_deal_history ON public.lead_deals;
CREATE OR REPLACE FUNCTION public.track_lead_deal_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  v_source := COALESCE(current_setting('app.lead_deal_change_source', true), 'manual');
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_deal_history (deal_id, lead_id, old_stage, new_stage, next_step, next_step_due_date, changed_by_id, change_source, changed_at)
    VALUES (NEW.id, NEW.lead_id, NULL, NEW.stage, NEW.next_step, NEW.next_step_due_date, auth.uid(), v_source, NEW.stage_started_at);
  ELSIF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.lead_deal_history (deal_id, lead_id, old_stage, new_stage, next_step, next_step_due_date, changed_by_id, change_source, changed_at)
    VALUES (NEW.id, NEW.lead_id, OLD.stage, NEW.stage, NEW.next_step, NEW.next_step_due_date, auth.uid(), v_source, NEW.stage_started_at);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_track_lead_deal_history AFTER INSERT OR UPDATE ON public.lead_deals FOR EACH ROW EXECUTE FUNCTION public.track_lead_deal_history();
CREATE TRIGGER trg_lead_deals_updated_at BEFORE UPDATE ON public.lead_deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
REVOKE ALL ON FUNCTION public.track_lead_deal_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_lead_deal_history() TO service_role;
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS follow_up_reply_state text,
  ADD COLUMN IF NOT EXISTS follow_up_reply_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS automation_paused boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_follow_up_reply_state_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_follow_up_reply_state_check
  CHECK (follow_up_reply_state IS NULL OR follow_up_reply_state IN ('interested', 'reason_requested'));

CREATE INDEX IF NOT EXISTS idx_leads_follow_up_reply_priority
  ON public.leads (follow_up_reply_state, follow_up_reply_at DESC)
  WHERE deleted_at IS NULL AND follow_up_reply_state IS NOT NULL;

COMMENT ON COLUMN public.leads.follow_up_reply_state IS 'Current actionable WhatsApp follow-up state: interested or reason_requested.';
COMMENT ON COLUMN public.leads.follow_up_reply_at IS 'Timestamp of the latest actionable Yes/No follow-up reply.';
COMMENT ON COLUMN public.leads.automation_paused IS 'Pauses automatic nurture messages while a salesperson reviews a negative reply.';
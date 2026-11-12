-- Tap-cards under a coach check-in: the 1-3 things the check-in points at (leads,
-- service jobs or approvals) and what the person did with each. Written by the
-- staff-agent function (service role); readable under the existing row policies.
ALTER TABLE public.staff_agent_messages
  ADD COLUMN IF NOT EXISTS items jsonb;

COMMENT ON COLUMN public.staff_agent_messages.items IS
  'Check-in tap-cards: [{id, kind lead|job|approval, title, reason, lead_id?, phone?, route?, state pending|done|skipped, result?}]';

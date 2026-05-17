-- Enable full replica identity on notifications so the realtime row-filter
-- used by LeadNotifier (filter: user_id=eq.<id>) works correctly.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: get or create a DM channel between two explicit user IDs.
-- SECURITY DEFINER (owned by postgres) so it bypasses RLS when called
-- from a trigger context where auth.uid() is not a privileged role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_dm_channel_for_users(
  _from_user uuid,
  _to_user   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel uuid;
BEGIN
  SELECT c.id INTO v_channel
  FROM   public.chat_channels c
  WHERE  c.kind = 'dm'
    AND  EXISTS (SELECT 1 FROM public.chat_channel_members WHERE channel_id = c.id AND user_id = _from_user)
    AND  EXISTS (SELECT 1 FROM public.chat_channel_members WHERE channel_id = c.id AND user_id = _to_user)
    AND  (SELECT COUNT(*) FROM public.chat_channel_members WHERE channel_id = c.id) = 2
  LIMIT 1;

  IF v_channel IS NOT NULL THEN
    RETURN v_channel;
  END IF;

  INSERT INTO public.chat_channels(name, kind, created_by)
  VALUES ('dm', 'dm', _from_user)
  RETURNING id INTO v_channel;

  INSERT INTO public.chat_channel_members(channel_id, user_id)
  VALUES (v_channel, _from_user), (v_channel, _to_user);

  RETURN v_channel;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger function: fires after INSERT or UPDATE on leads when assigned_to
-- changes.  Inserts a notification + chat DM.
--
-- Deduplication: the client-side LeadAssignmentModal also inserts a
-- notification immediately after updateLead.  To avoid a duplicate when both
-- fire, the message includes "[lead:<uuid>]" and we skip if an identical
-- notification was already inserted in the last 30 seconds.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_lead_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee_id   uuid;
  v_from_user     uuid;
  v_channel_id    uuid;
  v_from_name     text;
  v_value_fmt     text;
  v_followup_str  text;
  v_notif_msg     text;
  v_msg_body      text;
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to) THEN
    RETURN NEW;
  END IF;

  v_assignee_id := NEW.assigned_to;
  v_from_user   := COALESCE(NEW.updated_by, NEW.created_by);
  v_value_fmt   := to_char(NEW.value_in_rupees::numeric, 'FM99,99,99,999');

  -- ── 1. Notification record ────────────────────────────────────────────────
  -- The tag "[lead:<id>]" lets both this trigger and the client-side code
  -- deduplicate: skip if same tag appeared in the last 30 seconds.
  v_notif_msg := 'New lead assigned: ' || NEW.customer_name
    || ' · ₹' || v_value_fmt
    || ' · '  || NEW.customer_phone
    || ' [lead:' || NEW.id::text || ']';

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE  user_id    = v_assignee_id
      AND  type       = 'lead_assigned'
      AND  message    LIKE '%[lead:' || NEW.id::text || ']%'
      AND  created_at > NOW() - INTERVAL '30 seconds'
  ) THEN
    INSERT INTO public.notifications (user_id, type, message)
    VALUES (v_assignee_id, 'lead_assigned', v_notif_msg);
  END IF;

  -- ── 2. Chat DM (best-effort) ──────────────────────────────────────────────
  BEGIN
    IF v_from_user IS NOT NULL THEN
      v_channel_id := public.get_or_create_dm_channel_for_users(v_from_user, v_assignee_id);

      SELECT name INTO v_from_name FROM public.profiles WHERE id = v_from_user LIMIT 1;
      v_from_name := COALESCE(v_from_name, 'Admin');

      v_followup_str := CASE
        WHEN NEW.next_follow_up_date IS NOT NULL THEN to_char(NEW.next_follow_up_date, 'DD/MM/YYYY')
        ELSE 'Not set'
      END;

      v_msg_body :=
        '🎯 NEW LEAD ASSIGNED'                            || E'\n\n' ||
        '👤 Customer: '  || NEW.customer_name             || E'\n'   ||
        '📱 Phone: '     || NEW.customer_phone            || E'\n'   ||
        '🛋️ Product: '  || NEW.category::text            || E'\n'   ||
        '💰 Value: ₹'   || v_value_fmt                   || E'\n'   ||
        '📅 Follow-up: ' || v_followup_str               || E'\n\n' ||
        'Assigned by: '  || v_from_name;

      IF NEW.assignment_notes IS NOT NULL AND NEW.assignment_notes <> '' THEN
        v_msg_body := v_msg_body || E'\n📝 Notes: ' || NEW.assignment_notes;
      END IF;

      -- Skip DM if one was already sent in the last 30 seconds for this lead
      IF NOT EXISTS (
        SELECT 1 FROM public.chat_messages
        WHERE  sender_id   = v_from_user
          AND  channel_id  = v_channel_id
          AND  body        LIKE '%NEW LEAD ASSIGNED%' || NEW.customer_name || '%'
          AND  created_at  > NOW() - INTERVAL '30 seconds'
      ) THEN
        INSERT INTO public.chat_messages (channel_id, sender_id, body)
        VALUES (v_channel_id, v_from_user, v_msg_body);
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'lead_assignment DM failed for lead %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_assignment_notify ON public.leads;

CREATE TRIGGER trg_lead_assignment_notify
  AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_lead_assignment();

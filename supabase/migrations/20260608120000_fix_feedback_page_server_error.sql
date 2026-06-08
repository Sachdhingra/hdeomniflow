
-- Fix: Internal Server Error on /kiosk/feedback page (feedback submission fails)
--
-- Root cause 1 (critical - ALL submissions broken):
--   Migration 20260522011940 accidentally changed trg_customer_feedback_thank_you
--   from AFTER INSERT to BEFORE INSERT. The function inserts into
--   pending_thank_you_messages which has a non-deferrable FK on
--   customer_feedback(id). Running it BEFORE the row exists causes:
--     "insert ... violates foreign key constraint ... is not present in table customer_feedback"
--   Fix: restore AFTER INSERT; update the row's thank_you_template via UPDATE
--   (NEW.xxx assignments are no-ops in AFTER triggers).
--
-- Root cause 2 (affects submissions creating/updating leads):
--   lead_deduplication_log was created by migration 20260521130000 with column
--   "phone", but every subsequent trigger version writes "customer_phone".
--   Fix: rename the column; also add missing "source" and "created_by" columns.

-- ── Fix 2: align lead_deduplication_log schema ──────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'lead_deduplication_log'
      AND column_name  = 'phone'
  ) THEN
    ALTER TABLE public.lead_deduplication_log RENAME COLUMN phone TO customer_phone;
  END IF;
END $$;

ALTER TABLE public.lead_deduplication_log
  ADD COLUMN IF NOT EXISTS source     text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DROP INDEX IF EXISTS public.idx_dedup_log_phone;
CREATE INDEX IF NOT EXISTS idx_dedup_log_phone
  ON public.lead_deduplication_log(customer_phone);

-- Drop the superseded AFTER INSERT dedup trigger (May 21 migration artifact).
-- handle_customer_feedback_insert BEFORE trigger now owns all dedup work.
DROP TRIGGER IF EXISTS trg_customer_feedback_dedup_lead ON public.customer_feedback;

-- ── Fix 1: restore AFTER INSERT for thank-you trigger ───────────────────────

CREATE OR REPLACE FUNCTION public.create_thank_you_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tmpl TEXT;
BEGIN
  IF NEW.overall_rating = 5 AND NEW.staff_rating = 5 THEN
    tmpl := 'Hi ' || NEW.customer_name || E'! :star:\n\nWe''re absolutely thrilled with your amazing feedback! You made our day.\n\nWe''d love your Google review.\n\nAs a thank you, here''s 10% off: code THANKYOU10\n\nSee you soon!\nHome Decor Enterprises - Patel Nagar';
  ELSIF NEW.overall_rating >= 4 THEN
    tmpl := 'Hi ' || NEW.customer_name || E'!\n\nThank you for the wonderful feedback!\n\nSpecial offer: 5% off - code VISITAGAIN5.\n\nHome Decor Enterprises';
  ELSIF NEW.overall_rating = 3 THEN
    tmpl := 'Hi ' || NEW.customer_name || E'!\n\nThank you for your feedback! We appreciate it.\n\nHow can we improve? Let us know anytime.\nHome Decor Enterprises';
  ELSE
    tmpl := 'Hi ' || NEW.customer_name || E'!\n\nThank you for your honest feedback. We''re sorry we didn''t meet your expectations.\n\nHow can we make it right? Please call us.\nHome Decor Enterprises';
  END IF;

  -- Update the already-inserted row to store the rendered template.
  -- (This must be UPDATE because NEW.xxx writes are ignored in AFTER triggers.)
  UPDATE public.customer_feedback
    SET thank_you_template = tmpl
  WHERE id = NEW.id;

  -- The FK on pending_thank_you_messages.feedback_id is now satisfied because
  -- the customer_feedback row has already been committed when AFTER fires.
  INSERT INTO public.pending_thank_you_messages(feedback_id, phone, message, scheduled_send_time, status)
  VALUES (NEW.id, NEW.customer_phone, tmpl, now(), 'pending');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_feedback_thank_you ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_thank_you
  AFTER INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.create_thank_you_message();

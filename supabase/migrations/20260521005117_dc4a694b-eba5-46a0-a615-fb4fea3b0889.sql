
-- Extend customer_feedback with kiosk + thank-you tracking columns
ALTER TABLE public.customer_feedback
  ADD COLUMN IF NOT EXISTS showroom_id TEXT NOT NULL DEFAULT 'patel_nagar',
  ADD COLUMN IF NOT EXISTS reviewed_on_google BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thank_you_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thank_you_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thank_you_template TEXT;

-- Queue of outgoing thank-you messages
CREATE TABLE IF NOT EXISTS public.pending_thank_you_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id UUID NOT NULL REFERENCES public.customer_feedback(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  scheduled_send_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_thank_you_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view thank you queue" ON public.pending_thank_you_messages;
CREATE POLICY "Admins view thank you queue"
  ON public.pending_thank_you_messages FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update thank you queue" ON public.pending_thank_you_messages;
CREATE POLICY "Admins update thank you queue"
  ON public.pending_thank_you_messages FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger to auto-create a rating-aware thank-you message
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
    tmpl := 'Hi ' || NEW.customer_name || E'! 🌟\n\nWe''re absolutely thrilled with your amazing feedback! You made our day.\n\nWe''d love your Google review.\n\nAs a thank you, here''s 10% off: code THANKYOU10\n\nSee you soon! 🛋️\nHome Decor Enterprises - Patel Nagar';
  ELSIF NEW.overall_rating >= 4 THEN
    tmpl := 'Hi ' || NEW.customer_name || E'! 😊\n\nThank you for the wonderful feedback!\n\nSpecial offer: 5% off — code VISITAGAIN5.\n\nHome Decor Enterprises';
  ELSIF NEW.overall_rating = 3 THEN
    tmpl := 'Hi ' || NEW.customer_name || E'!\n\nThank you for your feedback! We appreciate it.\n\nHow can we improve? Let us know anytime.\nHome Decor Enterprises';
  ELSE
    tmpl := 'Hi ' || NEW.customer_name || E'!\n\nThank you for your honest feedback. We''re sorry we didn''t meet your expectations.\n\nHow can we make it right? Please call us.\nHome Decor Enterprises';
  END IF;

  NEW.thank_you_template := tmpl;

  INSERT INTO public.pending_thank_you_messages(feedback_id, phone, message, scheduled_send_time, status)
  VALUES (NEW.id, NEW.customer_phone, tmpl, now(), 'pending');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_feedback_thank_you ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_thank_you
  AFTER INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.create_thank_you_message();

-- Daily stats view (admin analytics)
CREATE OR REPLACE VIEW public.daily_feedback_stats AS
SELECT
  DATE(created_at) AS feedback_date,
  showroom_id,
  COUNT(*) AS total_feedback,
  ROUND(AVG(overall_rating)::numeric, 1) AS avg_overall_rating,
  ROUND(AVG(staff_rating)::numeric, 1) AS avg_experience_rating,
  COUNT(*) FILTER (WHERE overall_rating = 5) AS five_star_count,
  COUNT(*) FILTER (WHERE overall_rating = 4) AS four_star_count,
  COUNT(*) FILTER (WHERE overall_rating = 3) AS three_star_count,
  COUNT(*) FILTER (WHERE overall_rating <= 2) AS poor_count
FROM public.customer_feedback
GROUP BY DATE(created_at), showroom_id
ORDER BY feedback_date DESC;

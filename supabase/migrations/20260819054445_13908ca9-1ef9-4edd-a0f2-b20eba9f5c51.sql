CREATE TABLE public.push_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type text NOT NULL CHECK (campaign_type IN ('text', 'banner', 'offer')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 300),
  image_url text,
  link_url text,
  offer_code text,
  offer_expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  recipients_targeted integer NOT NULL DEFAULT 0 CHECK (recipients_targeted >= 0),
  recipients_sent integer NOT NULL DEFAULT 0 CHECK (recipients_sent >= 0),
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_campaigns TO authenticated;
GRANT ALL ON public.push_campaigns TO service_role;

ALTER TABLE public.push_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view push campaigns"
ON public.push_campaigns FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create push campaigns"
ON public.push_campaigns FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update push campaigns"
ON public.push_campaigns FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete push campaigns"
ON public.push_campaigns FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX push_campaigns_created_at_idx
ON public.push_campaigns (created_at DESC);

CREATE TABLE public.push_automation_settings (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_automation_settings TO authenticated;
GRANT ALL ON public.push_automation_settings TO service_role;

ALTER TABLE public.push_automation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view push automation settings"
ON public.push_automation_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create push automation settings"
ON public.push_automation_settings FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update push automation settings"
ON public.push_automation_settings FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete push automation settings"
ON public.push_automation_settings FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.push_automation_settings (key, label, description, enabled)
VALUES
  ('points_expiry', 'Points expiry reminders', 'Remind members before loyalty points expire.', true),
  ('birthday', 'Birthday greetings', 'Send members a birthday greeting and eligible reward reminder.', true),
  ('anniversary', 'Anniversary bonus', 'Notify eligible members when their annual anniversary points are credited.', true),
  ('redemption', 'Redemption updates', 'Notify members when redemption requests are processed.', true)
ON CONFLICT (key) DO NOTHING;
CREATE TABLE public.invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  phone text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_tokens_token ON public.invite_tokens(token);
CREATE INDEX idx_invite_tokens_customer ON public.invite_tokens(customer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite_tokens TO authenticated;
GRANT ALL ON public.invite_tokens TO service_role;

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and sales can view invite tokens"
ON public.invite_tokens FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales'::app_role));

CREATE POLICY "Admins and sales can create invite tokens"
ON public.invite_tokens FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales'::app_role));
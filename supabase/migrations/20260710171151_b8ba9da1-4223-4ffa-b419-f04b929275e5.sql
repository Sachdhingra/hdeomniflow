CREATE TABLE public.insider_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.insider_otp_codes TO service_role;

ALTER TABLE public.insider_otp_codes ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: table is service-role only.

CREATE INDEX idx_insider_otp_phone_created ON public.insider_otp_codes (phone, created_at DESC);
CREATE INDEX idx_insider_otp_expires ON public.insider_otp_codes (expires_at);
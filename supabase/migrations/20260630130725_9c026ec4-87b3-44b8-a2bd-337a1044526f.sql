ALTER TABLE public.invite_tokens
  ADD COLUMN IF NOT EXISTS redeemed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
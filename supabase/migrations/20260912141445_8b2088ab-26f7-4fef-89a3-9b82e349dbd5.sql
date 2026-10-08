ALTER TABLE public.scheme_banners
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';

ALTER TABLE public.scheme_banners
  DROP CONSTRAINT IF EXISTS scheme_banners_media_type_check;

ALTER TABLE public.scheme_banners
  ADD CONSTRAINT scheme_banners_media_type_check
  CHECK (media_type IN ('image', 'video'));
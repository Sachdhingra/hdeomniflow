-- Kiosk screensaver: allow looping videos alongside still scheme banners.

ALTER TABLE public.scheme_banners
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';

ALTER TABLE public.scheme_banners
  DROP CONSTRAINT IF EXISTS scheme_banners_media_type_check;
ALTER TABLE public.scheme_banners
  ADD CONSTRAINT scheme_banners_media_type_check
  CHECK (media_type IN ('image', 'video'));

-- Videos are uploaded raw (no canvas compression), so the bucket needs room
-- for them. 50 MB matches the admin-side limit in src/lib/kioskMedia.ts.
UPDATE storage.buckets
   SET file_size_limit = 52428800
 WHERE id = 'scheme-banners';

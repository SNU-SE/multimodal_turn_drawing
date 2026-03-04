-- Add content columns for question text/image content
-- and make image_url nullable (text-only questions allowed)

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS content TEXT DEFAULT NULL;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS content_image_url TEXT DEFAULT NULL;
ALTER TABLE public.questions ALTER COLUMN image_url DROP NOT NULL;

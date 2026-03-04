-- Add columns that exist in TypeScript types but are missing from init migration

ALTER TABLE public.room_groups ADD COLUMN IF NOT EXISTS question_ids TEXT[] DEFAULT '{}';
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS options JSONB;
ALTER TABLE public.room_questions ADD COLUMN IF NOT EXISTS is_correct BOOLEAN;

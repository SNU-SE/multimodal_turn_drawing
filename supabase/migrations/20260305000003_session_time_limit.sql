-- Add session_time_limit column to room_groups
-- NULL or 0 = no session time limit
-- Value in minutes (e.g., 30 = 30분)
ALTER TABLE public.room_groups
  ADD COLUMN IF NOT EXISTS session_time_limit INTEGER DEFAULT NULL;

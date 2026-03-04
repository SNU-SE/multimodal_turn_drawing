-- Add time_limit column to room_groups for session-wide time override
ALTER TABLE public.room_groups
  ADD COLUMN IF NOT EXISTS time_limit INTEGER DEFAULT NULL;

-- NULL = use per-question default_time_limit (backward compatible)

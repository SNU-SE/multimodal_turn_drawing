-- Create turns_log table for event tracking (PRD requirement)

CREATE TABLE public.turns_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  player_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,  -- turn_start, turn_end, timer_expired, answer_submitted, question_advanced
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_turns_log_room_id ON public.turns_log(room_id);

ALTER TABLE public.turns_log ENABLE ROW LEVEL SECURITY;

-- Permissive policy initially (will be replaced by Phase 4 production RLS)
CREATE POLICY "Enable all for turns_log" ON public.turns_log FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.turns_log;

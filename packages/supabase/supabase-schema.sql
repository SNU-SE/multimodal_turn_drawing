-- Create enum types
CREATE TYPE room_status AS ENUM ('pending', 'playing', 'completed');
CREATE TYPE question_type AS ENUM ('multiple_choice', 'essay');

-- 1. users table
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. room_groups table
CREATE TABLE public.room_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. rooms table
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.room_groups(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  status room_status NOT NULL DEFAULT 'pending',
  player1_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  turn_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. questions table
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  question_type question_type NOT NULL,
  correct_answer TEXT,
  default_time_limit INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. room_questions table
CREATE TABLE public.room_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  submitted_answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, question_id)
);

-- 6. canvas_logs table
CREATE TABLE public.canvas_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (Row Level Security) Configuration
-- For this setup with anonymous UUIDs, we'll open it up or manage it via service roles/functions later
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_logs ENABLE ROW LEVEL SECURITY;

-- Temporary open policies for development (Note: Needs refinement for production)
CREATE POLICY "Enable read access for all users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Enable all access for all users" ON public.rooms FOR ALL USING (true);
CREATE POLICY "Enable read access for all active rounds" ON public.questions FOR SELECT USING (true);
CREATE POLICY "Enable insert for logs" ON public.canvas_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable read for logs" ON public.canvas_logs FOR SELECT USING (true);
CREATE POLICY "Enable insert for room questions" ON public.room_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable read room_groups" ON public.room_groups FOR SELECT USING (true);

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create users table (for admin aliases, players)
CREATE TABLE public.users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  admin_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Create room_groups table
CREATE TABLE public.room_groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Create rooms table
CREATE TABLE public.rooms (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  group_id UUID REFERENCES public.room_groups(id) ON DELETE CASCADE,
  code TEXT UNIQUE,
  player1_invite_code TEXT UNIQUE,
  player2_invite_code TEXT UNIQUE,
  status TEXT DEFAULT 'pending'::text, -- 'pending', 'playing', 'completed'
  player1_id UUID REFERENCES public.users(id),
  player2_id UUID REFERENCES public.users(id),
  current_question_index INTEGER DEFAULT 0,
  turn_state JSONB DEFAULT '{"isPaused": true, "timeLeft": 60}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. Create questions table
CREATE TABLE public.questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  image_url TEXT NOT NULL,
  question_type TEXT DEFAULT 'essay'::text, -- 'multiple_choice', 'essay'
  correct_answer TEXT,
  default_time_limit INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. Create room_questions table
CREATE TABLE public.room_questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  submitted_answer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. Create canvas_logs table
CREATE TABLE public.canvas_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_logs ENABLE ROW LEVEL SECURITY;

-- 9. Create RLS Policies (Allow all for development. You should restrict this in production.)
CREATE POLICY "Enable all for users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for room_groups" ON public.room_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for rooms" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for questions" ON public.questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for room_questions" ON public.room_questions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for canvas_logs" ON public.canvas_logs FOR ALL USING (true) WITH CHECK (true);

-- 10. Enable Realtime Publications
-- We need to enable realtime for specific tables if we want changes to broadcast
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms, public.canvas_logs;

-- Production RLS policies
-- Players use anon role (no login), admins use authenticated role (Supabase Auth)

-- ============================================================
-- Drop existing permissive policies
-- ============================================================
DROP POLICY IF EXISTS "Enable all for users" ON public.users;
DROP POLICY IF EXISTS "Enable all for room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "Enable all for rooms" ON public.rooms;
DROP POLICY IF EXISTS "Enable all for questions" ON public.questions;
DROP POLICY IF EXISTS "Enable all for room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "Enable all for canvas_logs" ON public.canvas_logs;
DROP POLICY IF EXISTS "Enable all for turns_log" ON public.turns_log;

-- ============================================================
-- users: anon can SELECT, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_users" ON public.users
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_all_users" ON public.users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- room_groups: anon can SELECT, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_room_groups" ON public.room_groups
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_all_room_groups" ON public.room_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- rooms: anon can SELECT + UPDATE, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_rooms" ON public.rooms
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_update_rooms" ON public.rooms
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_rooms" ON public.rooms
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- questions: anon can SELECT, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_questions" ON public.questions
  FOR SELECT TO anon USING (true);

CREATE POLICY "auth_all_questions" ON public.questions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- room_questions: anon can SELECT + UPDATE, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_room_questions" ON public.room_questions
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_update_room_questions" ON public.room_questions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_room_questions" ON public.room_questions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- canvas_logs: anon can SELECT + INSERT, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_select_canvas_logs" ON public.canvas_logs
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_canvas_logs" ON public.canvas_logs
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "auth_all_canvas_logs" ON public.canvas_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- turns_log: anon can INSERT, authenticated can do ALL
-- ============================================================
CREATE POLICY "anon_insert_turns_log" ON public.turns_log
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "auth_all_turns_log" ON public.turns_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

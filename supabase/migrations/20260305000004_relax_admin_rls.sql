-- Relax RLS: allow anon role full access to admin-managed tables
-- (Admin uses hardcoded password + sessionStorage, not Supabase Auth,
--  so all requests come through as anon role)

-- ============================================================
-- room_groups: add INSERT, UPDATE, DELETE for anon
-- ============================================================
CREATE POLICY "anon_insert_room_groups" ON public.room_groups
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_room_groups" ON public.room_groups
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_room_groups" ON public.room_groups
  FOR DELETE TO anon USING (true);

-- ============================================================
-- rooms: add INSERT, DELETE for anon (UPDATE already exists)
-- ============================================================
CREATE POLICY "anon_insert_rooms" ON public.rooms
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_delete_rooms" ON public.rooms
  FOR DELETE TO anon USING (true);

-- ============================================================
-- users: add INSERT, UPDATE for anon
-- ============================================================
CREATE POLICY "anon_insert_users" ON public.users
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_users" ON public.users
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- questions: add INSERT, UPDATE, DELETE for anon
-- ============================================================
CREATE POLICY "anon_insert_questions" ON public.questions
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_questions" ON public.questions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_questions" ON public.questions
  FOR DELETE TO anon USING (true);

-- ============================================================
-- room_questions: add INSERT, DELETE for anon (UPDATE already exists)
-- ============================================================
CREATE POLICY "anon_insert_room_questions" ON public.room_questions
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_delete_room_questions" ON public.room_questions
  FOR DELETE TO anon USING (true);

-- ============================================================
-- turns_log: add SELECT for anon (INSERT already exists)
-- ============================================================
CREATE POLICY "anon_select_turns_log" ON public.turns_log
  FOR SELECT TO anon USING (true);

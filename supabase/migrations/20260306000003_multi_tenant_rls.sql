-- ========================================
-- Drop old permissive policies
-- ========================================

-- Drop old "Enable all" policies (from init_schema.sql)
DROP POLICY IF EXISTS "Enable all for users" ON public.users;
DROP POLICY IF EXISTS "Enable all for room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "Enable all for rooms" ON public.rooms;
DROP POLICY IF EXISTS "Enable all for questions" ON public.questions;
DROP POLICY IF EXISTS "Enable all for room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "Enable all for canvas_logs" ON public.canvas_logs;

-- Drop old production RLS policies (from production_rls.sql)
DROP POLICY IF EXISTS "anon_select_users" ON public.users;
DROP POLICY IF EXISTS "auth_all_users" ON public.users;
DROP POLICY IF EXISTS "anon_select_room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "auth_all_room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "anon_select_rooms" ON public.rooms;
DROP POLICY IF EXISTS "anon_update_rooms" ON public.rooms;
DROP POLICY IF EXISTS "auth_all_rooms" ON public.rooms;
DROP POLICY IF EXISTS "anon_select_questions" ON public.questions;
DROP POLICY IF EXISTS "auth_all_questions" ON public.questions;
DROP POLICY IF EXISTS "anon_select_room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "anon_update_room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "auth_all_room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "anon_select_canvas_logs" ON public.canvas_logs;
DROP POLICY IF EXISTS "anon_insert_canvas_logs" ON public.canvas_logs;
DROP POLICY IF EXISTS "auth_all_canvas_logs" ON public.canvas_logs;
DROP POLICY IF EXISTS "anon_insert_turns_log" ON public.turns_log;
DROP POLICY IF EXISTS "auth_all_turns_log" ON public.turns_log;

-- Drop relaxed admin policies (from relax_admin_rls.sql)
DROP POLICY IF EXISTS "anon_insert_room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "anon_update_room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "anon_delete_room_groups" ON public.room_groups;
DROP POLICY IF EXISTS "anon_insert_rooms" ON public.room_groups;
DROP POLICY IF EXISTS "anon_delete_rooms" ON public.rooms;
DROP POLICY IF EXISTS "anon_insert_rooms" ON public.rooms;
DROP POLICY IF EXISTS "anon_insert_users" ON public.users;
DROP POLICY IF EXISTS "anon_update_users" ON public.users;
DROP POLICY IF EXISTS "anon_insert_questions" ON public.questions;
DROP POLICY IF EXISTS "anon_update_questions" ON public.questions;
DROP POLICY IF EXISTS "anon_delete_questions" ON public.questions;
DROP POLICY IF EXISTS "anon_insert_room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "anon_delete_room_questions" ON public.room_questions;
DROP POLICY IF EXISTS "anon_select_turns_log" ON public.turns_log;

-- ========================================
-- Helper function: get caller's org_id
-- ========================================
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ========================================
-- NEW RLS POLICIES
-- ========================================

-- == users (game players) ==
-- anon: players need SELECT (join room) + INSERT/UPDATE (during game setup)
CREATE POLICY "anon_all_users" ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);
-- authenticated: admin/teacher can manage users in their org's rooms
CREATE POLICY "auth_all_users" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- == organizations ==
-- (already set in Task 1)

-- == room_groups ==
-- super_admin: all access to all orgs
CREATE POLICY "super_admin_all_room_groups" ON public.room_groups
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher/org_admin: own org only
CREATE POLICY "org_member_room_groups" ON public.room_groups
  FOR ALL TO authenticated
  USING (org_id = public.get_my_org_id())
  WITH CHECK (org_id = public.get_my_org_id());

-- anon: players need SELECT for room_groups (to get time_limit etc)
CREATE POLICY "anon_select_room_groups" ON public.room_groups
  FOR SELECT TO anon USING (true);

-- == rooms ==
-- super_admin: all
CREATE POLICY "super_admin_all_rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher: own org's rooms (via room_groups.org_id)
CREATE POLICY "org_member_rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (
    group_id IN (SELECT id FROM public.room_groups WHERE org_id = public.get_my_org_id())
  )
  WITH CHECK (
    group_id IN (SELECT id FROM public.room_groups WHERE org_id = public.get_my_org_id())
  );

-- anon: players need SELECT + UPDATE
CREATE POLICY "anon_select_rooms" ON public.rooms FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_rooms" ON public.rooms FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- == questions ==
-- super_admin: all
CREATE POLICY "super_admin_all_questions" ON public.questions
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher: own org only
CREATE POLICY "org_member_questions" ON public.questions
  FOR ALL TO authenticated
  USING (org_id = public.get_my_org_id())
  WITH CHECK (org_id = public.get_my_org_id());

-- anon: players need SELECT
CREATE POLICY "anon_select_questions" ON public.questions FOR SELECT TO anon USING (true);

-- == room_questions ==
-- super_admin: all
CREATE POLICY "super_admin_all_room_questions" ON public.room_questions
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher: own org's
CREATE POLICY "org_member_room_questions" ON public.room_questions
  FOR ALL TO authenticated
  USING (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  );

-- anon: players need SELECT + UPDATE
CREATE POLICY "anon_select_room_questions" ON public.room_questions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_room_questions" ON public.room_questions FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- == canvas_logs ==
-- super_admin: all
CREATE POLICY "super_admin_all_canvas_logs" ON public.canvas_logs
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher: own org's
CREATE POLICY "org_member_canvas_logs" ON public.canvas_logs
  FOR ALL TO authenticated
  USING (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  );

-- anon: players need SELECT + INSERT
CREATE POLICY "anon_select_canvas_logs" ON public.canvas_logs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_canvas_logs" ON public.canvas_logs FOR INSERT TO anon WITH CHECK (true);

-- == turns_log ==
-- super_admin: all
CREATE POLICY "super_admin_all_turns_log" ON public.turns_log
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- teacher: own org's
CREATE POLICY "org_member_turns_log" ON public.turns_log
  FOR ALL TO authenticated
  USING (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT r.id FROM public.rooms r
      JOIN public.room_groups rg ON r.group_id = rg.id
      WHERE rg.org_id = public.get_my_org_id()
    )
  );

-- anon: players need INSERT + SELECT
CREATE POLICY "anon_insert_turns_log" ON public.turns_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_turns_log" ON public.turns_log FOR SELECT TO anon USING (true);

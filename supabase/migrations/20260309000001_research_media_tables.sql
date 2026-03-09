-- ========================================
-- Research branch: media session & recording tables
-- ========================================

-- LiveKit session tracking per room
CREATE TABLE IF NOT EXISTS public.room_media_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  livekit_room_name TEXT NOT NULL,
  livekit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (livekit_status IN ('pending', 'active', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Recording file metadata
CREATE TABLE IF NOT EXISTS public.recording_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.room_media_sessions(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL
    CHECK (file_type IN ('p1_face', 'p2_face', 'p1_screen', 'p2_screen', 'composite')),
  file_path TEXT,
  gdrive_url TEXT,
  file_size BIGINT,
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'processing', 'uploaded', 'failed')),
  egress_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cursor position logs for research analysis
CREATE TABLE IF NOT EXISTS public.cursor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.users(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_sessions_room ON public.room_media_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_recording_files_room ON public.recording_files(room_id);
CREATE INDEX IF NOT EXISTS idx_recording_files_session ON public.recording_files(session_id);
CREATE INDEX IF NOT EXISTS idx_cursor_logs_room_ts ON public.cursor_logs(room_id, timestamp);

-- Enable RLS
ALTER TABLE public.room_media_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recording_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cursor_logs ENABLE ROW LEVEL SECURITY;

-- RLS: room_media_sessions
CREATE POLICY "super_admin_all_media_sessions" ON public.room_media_sessions
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "org_member_media_sessions" ON public.room_media_sessions
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

CREATE POLICY "anon_select_media_sessions" ON public.room_media_sessions
  FOR SELECT TO anon USING (true);

-- RLS: recording_files
CREATE POLICY "super_admin_all_recording_files" ON public.recording_files
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "org_member_recording_files" ON public.recording_files
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

-- RLS: cursor_logs
CREATE POLICY "super_admin_all_cursor_logs" ON public.cursor_logs
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "org_member_cursor_logs" ON public.cursor_logs
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

CREATE POLICY "anon_insert_cursor_logs" ON public.cursor_logs
  FOR INSERT TO anon WITH CHECK (true);

-- Publish new tables to Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_media_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recording_files;

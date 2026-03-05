-- organizations: stores school/institution info
CREATE TABLE public.organizations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  neis_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID REFERENCES auth.users(id)
);

-- profiles: extends Supabase Auth users with role and org
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'org_admin', 'teacher')),
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: organizations readable by all authenticated, writable by super_admin
CREATE POLICY "auth_read_orgs" ON public.organizations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "super_admin_write_orgs" ON public.organizations
  FOR ALL TO authenticated USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
  ) WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
  );

-- RLS: profiles readable by authenticated, writable via Edge Function (service_role bypasses RLS)
CREATE POLICY "auth_read_profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Index for fast org lookup by neis_code
CREATE INDEX idx_organizations_neis_code ON public.organizations(neis_code);
CREATE INDEX idx_profiles_org_id ON public.profiles(org_id);
CREATE INDEX idx_profiles_role ON public.profiles(role);

-- Seed: create the super_admin organization
INSERT INTO public.organizations (id, neis_code, name)
VALUES ('00000000-0000-0000-0000-000000000001', '0000000', '전체관리자');

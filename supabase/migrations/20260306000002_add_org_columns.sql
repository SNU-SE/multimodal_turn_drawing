-- Add org_id and created_by to room_groups
ALTER TABLE public.room_groups ADD COLUMN org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.room_groups ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Add org_id and created_by to questions
ALTER TABLE public.questions ADD COLUMN org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.questions ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Migrate existing data: assign to super_admin org
UPDATE public.room_groups SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.questions SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- Make org_id NOT NULL after data migration
ALTER TABLE public.room_groups ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.questions ALTER COLUMN org_id SET NOT NULL;

-- Indexes for org-based queries
CREATE INDEX idx_room_groups_org_id ON public.room_groups(org_id);
CREATE INDEX idx_questions_org_id ON public.questions(org_id);

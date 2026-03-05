# Multi-Tenant Admin System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the single-admin turn-based drawing platform to a 3-tier multi-tenant system (super_admin > org_admin > teacher) with Supabase Auth, Edge Functions, and org-based data isolation.

**Architecture:** Supabase Auth with auto-generated email patterns replaces the hardcoded password system. An Edge Function handles user creation with service_role_key server-side. RLS policies enforce org-based data isolation. URL routing uses NEIS school codes to scope org pages.

**Tech Stack:** React 19, React Router 7, Supabase Auth, Supabase Edge Functions (Deno), PostgreSQL RLS, Zustand, TypeScript

**Design Doc:** `docs/plans/2026-03-05-multi-tenant-design.md`

---

## Task 1: Database Migration - New Tables (organizations, profiles)

**Files:**
- Create: `supabase/migrations/20260306000001_multi_tenant_tables.sql`

**Step 1: Write the migration SQL**

```sql
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
```

**Step 2: Apply migration to VPS**

```bash
supabase db push --db-url "postgresql://postgres:PASSWORD@localhost:15433/postgres"
```

Expected: Migration applied successfully.

**Step 3: Verify tables exist**

```bash
# Via docker exec on VPS
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "\dt public.organizations; \dt public.profiles;"
```

Expected: Both tables listed.

**Step 4: Commit**

```bash
git add supabase/migrations/20260306000001_multi_tenant_tables.sql
git commit -m "feat: add organizations and profiles tables for multi-tenant"
```

---

## Task 2: Database Migration - Add org_id to Existing Tables

**Files:**
- Create: `supabase/migrations/20260306000002_add_org_columns.sql`

**Step 1: Write the migration SQL**

```sql
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
```

**Step 2: Apply migration**

```bash
supabase db push --db-url "postgresql://postgres:PASSWORD@localhost:15433/postgres"
```

**Step 3: Verify columns**

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "SELECT column_name FROM information_schema.columns WHERE table_name='room_groups' AND column_name IN ('org_id','created_by');"
```

Expected: Both columns listed.

**Step 4: Commit**

```bash
git add supabase/migrations/20260306000002_add_org_columns.sql
git commit -m "feat: add org_id to room_groups and questions for data isolation"
```

---

## Task 3: Database Migration - Multi-Tenant RLS Policies

**Files:**
- Create: `supabase/migrations/20260306000003_multi_tenant_rls.sql`

**Step 1: Write the RLS migration**

```sql
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
```

**Step 2: Apply migration**

```bash
supabase db push --db-url "postgresql://postgres:PASSWORD@localhost:15433/postgres"
```

**Step 3: Verify policies**

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;"
```

Expected: New multi-tenant policies listed, old permissive policies gone.

**Step 4: Commit**

```bash
git add supabase/migrations/20260306000003_multi_tenant_rls.sql
git commit -m "feat: replace permissive RLS with multi-tenant org-based policies"
```

---

## Task 4: Create Super Admin Account in Supabase Auth

This is a one-time server-side task to create the super_admin user.

**Step 1: Create the super admin user on VPS**

```bash
# SSH into VPS, then:
# Get the service_role_key from supabase .env
# Then create the user:
curl -X POST 'https://supabase.bioclass.kr/auth/v1/admin/users' \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@internal.bioclass.kr",
    "password": "YOUR_CHOSEN_PASSWORD",
    "email_confirm": true
  }'
```

Expected: JSON response with `id` field (the user's UUID).

**Step 2: Insert the super admin profile**

```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -c "
  INSERT INTO public.profiles (id, role, org_id, display_name)
  VALUES (
    'UUID_FROM_STEP_1',
    'super_admin',
    '00000000-0000-0000-0000-000000000001',
    '전체관리자'
  );
"
```

**Step 3: Verify login works**

```bash
curl -X POST 'https://supabase.bioclass.kr/auth/v1/token?grant_type=password' \
  -H "apikey: ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@internal.bioclass.kr",
    "password": "YOUR_CHOSEN_PASSWORD"
  }'
```

Expected: JSON response with `access_token`.

---

## Task 5: Edge Function - manage-users

**Files:**
- Create: `supabase/functions/manage-users/index.ts`

**Step 1: Create the Edge Function**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Get the caller's JWT from Authorization header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Create anon client to verify caller identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    // Verify caller using their JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Get caller's profile (role + org_id)
    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role, org_id")
      .eq("id", caller.id)
      .single()

    if (!callerProfile) {
      return new Response(JSON.stringify({ error: "No profile found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Parse request body
    const body = await req.json()
    const { action } = body

    // Service role client for admin operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    switch (action) {
      case "create_org": {
        // Only super_admin can create orgs
        if (callerProfile.role !== "super_admin") {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        const { neisCode, orgName, adminPassword } = body

        // Create organization
        const { data: org, error: orgError } = await adminClient
          .from("organizations")
          .insert({ neis_code: neisCode, name: orgName, created_by: caller.id })
          .select()
          .single()

        if (orgError) {
          return new Response(JSON.stringify({ error: orgError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Create org_admin auth user
        const email = `org-${neisCode}@internal.bioclass.kr`
        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password: adminPassword,
          email_confirm: true,
        })

        if (authError) {
          // Rollback org creation
          await adminClient.from("organizations").delete().eq("id", org.id)
          return new Response(JSON.stringify({ error: authError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Create org_admin profile
        await adminClient.from("profiles").insert({
          id: authUser.user.id,
          role: "org_admin",
          org_id: org.id,
          display_name: `${orgName} 관리자`,
        })

        return new Response(JSON.stringify({ org, email }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      case "create_teacher": {
        // org_admin can create teachers in their org
        // super_admin can create teachers in any org
        const { teacherId, password, displayName, orgId } = body

        const targetOrgId = callerProfile.role === "super_admin" ? (orgId || callerProfile.org_id) : callerProfile.org_id

        if (callerProfile.role === "org_admin" && orgId && orgId !== callerProfile.org_id) {
          return new Response(JSON.stringify({ error: "Cannot create teacher in other org" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        if (!["super_admin", "org_admin"].includes(callerProfile.role)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Get org's neis_code for email pattern
        const { data: org } = await adminClient
          .from("organizations")
          .select("neis_code")
          .eq("id", targetOrgId)
          .single()

        if (!org) {
          return new Response(JSON.stringify({ error: "Organization not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        const email = `t-${teacherId}-${org.neis_code}@internal.bioclass.kr`

        const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })

        if (authError) {
          return new Response(JSON.stringify({ error: authError.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        await adminClient.from("profiles").insert({
          id: authUser.user.id,
          role: "teacher",
          org_id: targetOrgId,
          display_name: displayName,
        })

        return new Response(JSON.stringify({ teacherId, email, displayName }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      case "list_teachers": {
        // org_admin: list teachers in their org
        // super_admin: list teachers in any org
        const { orgId } = body
        const targetOrgId = callerProfile.role === "super_admin" ? (orgId || callerProfile.org_id) : callerProfile.org_id

        const { data: teachers } = await adminClient
          .from("profiles")
          .select("id, display_name, created_at")
          .eq("org_id", targetOrgId)
          .eq("role", "teacher")
          .order("created_at", { ascending: true })

        return new Response(JSON.stringify({ teachers }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      case "delete_user": {
        const { userId } = body

        // Get target user's profile
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("role, org_id")
          .eq("id", userId)
          .single()

        if (!targetProfile) {
          return new Response(JSON.stringify({ error: "User not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Permission checks
        if (callerProfile.role === "org_admin") {
          if (targetProfile.org_id !== callerProfile.org_id || targetProfile.role !== "teacher") {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
          }
        } else if (callerProfile.role !== "super_admin") {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Delete from auth (cascade deletes profile)
        await adminClient.auth.admin.deleteUser(userId)

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      case "update_password": {
        const { userId, newPassword } = body

        // Get target user's profile
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("role, org_id")
          .eq("id", userId)
          .single()

        if (!targetProfile) {
          return new Response(JSON.stringify({ error: "User not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Permission checks
        if (callerProfile.role === "org_admin") {
          if (targetProfile.org_id !== callerProfile.org_id || targetProfile.role !== "teacher") {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
          }
        } else if (callerProfile.role !== "super_admin") {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        await adminClient.auth.admin.updateUserById(userId, { password: newPassword })

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
```

**Step 2: Create shared CORS helper**

Create: `supabase/functions/_shared/cors.ts`

```typescript
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
```

**Step 3: Deploy to VPS**

Deploy the function files to the VPS Supabase functions volume. The edge-runtime container auto-detects new functions.

```bash
# SCP files to VPS or use the Supabase CLI
# The exact deployment depends on how the VPS Supabase functions volume is mounted
```

**Step 4: Test the function**

```bash
# Test create_org (using super admin's token from Task 4)
curl -X POST 'https://supabase.bioclass.kr/functions/v1/manage-users' \
  -H "Authorization: Bearer SUPER_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "create_org", "neisCode": "7010057", "orgName": "테스트학교", "adminPassword": "test1234"}'
```

Expected: JSON with org details.

**Step 5: Commit**

```bash
git add supabase/functions/
git commit -m "feat: add manage-users Edge Function for secure user CRUD"
```

---

## Task 6: Supabase Client - Add Auth Support

**Files:**
- Modify: `apps/web/src/lib/supabase.ts`

**Step 1: Update supabase client**

Replace the existing `supabase.ts` with:

```typescript
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@turn-based-drawing/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
```

No changes needed to the client itself. Supabase JS client already supports auth via anon key. When a user logs in with `supabase.auth.signInWithPassword()`, subsequent requests automatically use the authenticated JWT.

**Step 2: Create auth helper**

Create: `apps/web/src/lib/auth.ts`

```typescript
import { supabase } from './supabase'

export type UserRole = 'super_admin' | 'org_admin' | 'teacher'

export interface UserProfile {
  id: string
  role: UserRole
  org_id: string
  display_name: string
}

/** Get current user's profile from profiles table */
export async function getMyProfile(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return data as UserProfile | null
}

/** Sign in with email pattern based on role */
export async function signInSuperAdmin(password: string) {
  return supabase.auth.signInWithPassword({
    email: 'superadmin@internal.bioclass.kr',
    password,
  })
}

export async function signInOrgAdmin(neisCode: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: `org-${neisCode}@internal.bioclass.kr`,
    password,
  })
}

export async function signInTeacher(teacherId: string, neisCode: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: `t-${teacherId}-${neisCode}@internal.bioclass.kr`,
    password,
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

/** Invoke Edge Function for user management */
export async function manageUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) throw error
  return data
}
```

**Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "feat: add auth helper with role-based sign-in and user management"
```

---

## Task 7: AuthGuard - Supabase Auth Integration

**Files:**
- Modify: `apps/web/src/components/auth/AuthGuard.tsx`

**Step 1: Rewrite AuthGuard**

Replace entire file with:

```typescript
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { getMyProfile, type UserRole } from "@/lib/auth"
import { logger } from "@/lib/logger"

interface AuthGuardProps {
  children: React.ReactNode
  allowedRoles?: UserRole[]
  redirectTo?: string
}

export default function AuthGuard({ children, allowedRoles, redirectTo = "/" }: AuthGuardProps) {
  const navigate = useNavigate()
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        logger.warn("[AuthGuard] No session — redirecting to", redirectTo)
        navigate(redirectTo, { replace: true })
        return
      }

      if (allowedRoles) {
        const profile = await getMyProfile()
        if (!profile || !allowedRoles.includes(profile.role)) {
          logger.warn("[AuthGuard] Role mismatch — redirecting")
          navigate(redirectTo, { replace: true })
          return
        }
      }

      setAuthenticated(true)
    }

    check()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate(redirectTo, { replace: true })
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate, redirectTo, allowedRoles])

  if (!authenticated) return null

  return <>{children}</>
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/auth/AuthGuard.tsx
git commit -m "feat: upgrade AuthGuard to Supabase Auth with role-based access"
```

---

## Task 8: Super Admin Pages

**Files:**
- Create: `apps/web/src/pages/superadmin/SuperAdminLogin.tsx`
- Create: `apps/web/src/pages/superadmin/SuperAdminLayout.tsx`
- Create: `apps/web/src/pages/superadmin/SuperAdminDashboard.tsx`
- Create: `apps/web/src/pages/superadmin/OrgDetail.tsx`

### Step 1: SuperAdminLogin

```typescript
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signInSuperAdmin } from "@/lib/auth"

export default function SuperAdminLogin() {
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error: authError } = await signInSuperAdmin(password)
    if (authError) {
      setError("비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    navigate("/superadmin")
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm shadow-lg">
        <CardContent className="p-8">
          <h2 className="text-lg font-semibold text-center mb-4">전체 관리자</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              required
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

### Step 2: SuperAdminLayout

```typescript
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { Building2, Users, Settings, LogOut, BarChart3 } from "lucide-react"
import { signOut } from "@/lib/auth"

export default function SuperAdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const isOrgsActive = location.pathname === "/superadmin" || location.pathname.startsWith("/superadmin/orgs")
  const isSessionsActive = location.pathname.startsWith("/superadmin/groups") || location.pathname.startsWith("/superadmin/recap")
  const isQuestionsActive = location.pathname === "/superadmin/questions"

  const handleSignOut = async () => {
    await signOut()
    navigate("/superadmin/login")
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <h2 className="text-xl font-bold tracking-tight">전체 관리자</h2>
        </div>
        <nav className="flex-1 space-y-2">
          <Link to="/superadmin" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isOrgsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Building2 className="w-5 h-5" />
            기관 관리
          </Link>
          <Link to="/superadmin/groups" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSessionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Users className="w-5 h-5" />
            세션 관리
          </Link>
          <Link to="/superadmin/questions" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isQuestionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Settings className="w-5 h-5" />
            문제 은행
          </Link>
        </nav>
        <div className="mt-auto">
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 px-3 py-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors">
            <LogOut className="w-5 h-5" />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        <header className="h-16 border-b flex items-center px-8 bg-card shrink-0">
          <h1 className="text-xl font-semibold">전체 관리자 대시보드</h1>
        </header>
        <div className="flex-1 p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
```

### Step 3: SuperAdminDashboard (기관 관리)

```typescript
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { manageUsers } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "lucide-react"

interface Org {
  id: string
  neis_code: string
  name: string
  created_at: string
  teacherCount: number
  sessionCount: number
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [neisCode, setNeisCode] = useState("")
  const [orgName, setOrgName] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const fetchOrgs = async () => {
    const { data: orgData } = await supabase
      .from("organizations")
      .select("*")
      .neq("neis_code", "0000000") // Exclude super_admin org
      .order("created_at", { ascending: false })

    if (!orgData) return

    // Get teacher counts and session counts per org
    const { data: profileData } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("role", "teacher")

    const { data: groupData } = await supabase
      .from("room_groups")
      .select("org_id")

    const mapped = orgData.map((o: any) => ({
      ...o,
      teacherCount: profileData?.filter((p: any) => p.org_id === o.id).length || 0,
      sessionCount: groupData?.filter((g: any) => g.org_id === o.id).length || 0,
    }))

    setOrgs(mapped)
  }

  useEffect(() => { fetchOrgs() }, [])

  const handleCreateOrg = async () => {
    if (!neisCode || !orgName || !adminPassword) return
    setLoading(true)
    try {
      await manageUsers({
        action: "create_org",
        neisCode,
        orgName,
        adminPassword,
      })
      setIsCreateOpen(false)
      setNeisCode("")
      setOrgName("")
      setAdminPassword("")
      fetchOrgs()
    } catch (err: any) {
      alert(`기관 생성 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">기관 목록</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />기관 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 기관 추가</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input placeholder="NEIS 행정표준코드 (7자리)" value={neisCode} onChange={(e) => setNeisCode(e.target.value)} maxLength={7} />
              <Input placeholder="학교/기관명" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <Input type="password" placeholder="기관 관리자 비밀번호" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              <Button onClick={handleCreateOrg} className="w-full" disabled={loading}>
                {loading ? "생성 중..." : "생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {orgs.map((org) => (
          <Card key={org.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/superadmin/orgs/${org.neis_code}`)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{org.name}</CardTitle>
              <p className="text-sm text-muted-foreground">NEIS: {org.neis_code}</p>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm">
                <span>교사 {org.teacherCount}명</span>
                <span>세션 {org.sessionCount}개</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                접속 URL: /{org.neis_code}/admin
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

### Step 4: OrgDetail (기관 상세)

```typescript
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import * as XLSX from "xlsx"

export default function OrgDetail() {
  const { neisCode } = useParams<{ neisCode: string }>()
  const [org, setOrg] = useState<any>(null)
  const [teachers, setTeachers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])

  useEffect(() => {
    const fetchData = async () => {
      // Get org
      const { data: orgData } = await supabase
        .from("organizations")
        .select("*")
        .eq("neis_code", neisCode!)
        .single()
      if (!orgData) return
      setOrg(orgData)

      // Get teachers
      const { data: teacherData } = await supabase
        .from("profiles")
        .select("*")
        .eq("org_id", orgData.id)
        .eq("role", "teacher")
        .order("created_at")
      setTeachers(teacherData || [])

      // Get sessions with room counts
      const { data: groupData } = await supabase
        .from("room_groups")
        .select("*")
        .eq("org_id", orgData.id)
        .order("created_at", { ascending: false })

      const { data: roomData } = await supabase
        .from("rooms")
        .select("id, group_id, status")

      const mapped = (groupData || []).map((g: any) => {
        const grpRooms = (roomData || []).filter((r: any) => r.group_id === g.id)
        return {
          ...g,
          total: grpRooms.length,
          pending: grpRooms.filter((r: any) => r.status === "pending").length,
          playing: grpRooms.filter((r: any) => r.status === "playing").length,
          completed: grpRooms.filter((r: any) => r.status === "completed").length,
        }
      })
      setSessions(mapped)
    }
    fetchData()
  }, [neisCode])

  const handleDownload = async () => {
    // Download all session data for this org as Excel
    const rows: any[] = []
    for (const session of sessions) {
      const { data: rooms } = await supabase
        .from("rooms")
        .select("*, room_questions(*, questions(*))")
        .eq("group_id", session.id)

      for (const room of rooms || []) {
        for (const rq of (room as any).room_questions || []) {
          rows.push({
            세션명: session.name,
            방코드: room.code,
            문제: rq.questions?.title || rq.question_id,
            제출답안: rq.submitted_answer,
            정답여부: rq.is_correct,
          })
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "데이터")
    XLSX.writeFile(wb, `${org?.name || neisCode}_data.xlsx`)
  }

  if (!org) return <div>로딩 중...</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">{org.name}</h2>
          <p className="text-muted-foreground">NEIS: {org.neis_code}</p>
        </div>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-2" />전체 데이터 다운로드
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>교사 목록 ({teachers.length}명)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th className="text-left py-2">이름</th><th className="text-left py-2">등록일</th></tr></thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">{t.display_name}</td>
                  <td className="py-2">{new Date(t.created_at).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>세션 현황 ({sessions.length}개)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    대기 {s.pending} | 진행 {s.playing} | 완료 {s.completed} | 전체 {s.total}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

### Step 5: Commit

```bash
git add apps/web/src/pages/superadmin/
git commit -m "feat: add super admin pages (login, layout, dashboard, org detail)"
```

---

## Task 9: Organization Login Page

**Files:**
- Create: `apps/web/src/pages/org/OrgLogin.tsx`

**Step 1: Create OrgLogin with teacher + org_admin tabs**

```typescript
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signInOrgAdmin, signInTeacher } from "@/lib/auth"

export default function OrgLogin() {
  const { neis } = useParams<{ neis: string }>()
  const navigate = useNavigate()
  const [isOrgAdminMode, setIsOrgAdminMode] = useState(false)
  const [teacherId, setTeacherId] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!neis) return
    setLoading(true)
    setError(null)

    const { error: authError } = await signInTeacher(teacherId, neis, password)
    if (authError) {
      setError("ID 또는 비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    navigate(`/${neis}/admin`)
  }

  const handleOrgAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!neis) return
    setLoading(true)
    setError(null)

    const { error: authError } = await signInOrgAdmin(neis, password)
    if (authError) {
      setError("비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    navigate(`/${neis}/admin`)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">관리자 로그인</CardTitle>
          <CardDescription>기관 코드: {neis}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOrgAdminMode ? (
            <form onSubmit={handleTeacherLogin} className="space-y-4">
              <Input
                placeholder="교사 ID"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                required
                autoFocus
              />
              <Input
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "로그인 중..." : "교사 로그인"}
              </Button>
              <button
                type="button"
                onClick={() => { setIsOrgAdminMode(true); setError(null); setPassword("") }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                기관 관리자이신가요?
              </button>
            </form>
          ) : (
            <form onSubmit={handleOrgAdminLogin} className="space-y-4">
              <Input
                type="password"
                placeholder="기관 관리자 비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "로그인 중..." : "기관 관리자 로그인"}
              </Button>
              <button
                type="button"
                onClick={() => { setIsOrgAdminMode(false); setError(null); setPassword("") }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                교사 로그인으로 돌아가기
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/web/src/pages/org/OrgLogin.tsx
git commit -m "feat: add org login page with teacher/org_admin mode toggle"
```

---

## Task 10: Organization Admin Dashboard (Teacher CRUD)

**Files:**
- Create: `apps/web/src/pages/org/OrgAdminDashboard.tsx`

**Step 1: Create OrgAdminDashboard**

```typescript
import { useEffect, useState } from "react"
import { manageUsers, getMyProfile } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, Trash2, KeyRound } from "lucide-react"

interface Teacher {
  id: string
  display_name: string
  created_at: string
}

export default function OrgAdminDashboard() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [teacherId, setTeacherId] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const fetchTeachers = async () => {
    const profile = await getMyProfile()
    if (!profile) return
    const data = await manageUsers({ action: "list_teachers", orgId: profile.org_id })
    setTeachers(data.teachers || [])
  }

  useEffect(() => { fetchTeachers() }, [])

  const handleCreateTeacher = async () => {
    if (!teacherId || !displayName || !password) return
    setLoading(true)
    try {
      await manageUsers({
        action: "create_teacher",
        teacherId,
        displayName,
        password,
      })
      setIsCreateOpen(false)
      setTeacherId("")
      setDisplayName("")
      setPassword("")
      fetchTeachers()
    } catch (err: any) {
      alert(`교사 생성 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteTeacher = async (userId: string, name: string) => {
    if (!confirm(`${name} 교사를 삭제하시겠습니까?`)) return
    try {
      await manageUsers({ action: "delete_user", userId })
      fetchTeachers()
    } catch (err: any) {
      alert(`삭제 실패: ${err.message}`)
    }
  }

  const handleResetPassword = async (userId: string) => {
    const newPw = prompt("새 비밀번호를 입력하세요:")
    if (!newPw) return
    try {
      await manageUsers({ action: "update_password", userId, newPassword: newPw })
      alert("비밀번호가 변경되었습니다.")
    } catch (err: any) {
      alert(`변경 실패: ${err.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">교사 관리</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />교사 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>교사 계정 생성</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input placeholder="교사 ID (영문+숫자)" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} />
              <Input placeholder="표시 이름" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <Input type="password" placeholder="초기 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button onClick={handleCreateTeacher} className="w-full" disabled={loading}>
                {loading ? "생성 중..." : "생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>등록된 교사 ({teachers.length}명)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">이름</th>
                <th className="text-left py-2">등록일</th>
                <th className="text-right py-2">관리</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">{t.display_name}</td>
                  <td className="py-2">{new Date(t.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2 text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleResetPassword(t.id)}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteTeacher(t.id, t.display_name)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/web/src/pages/org/OrgAdminDashboard.tsx
git commit -m "feat: add org admin dashboard with teacher CRUD"
```

---

## Task 11: Organization Layout

**Files:**
- Create: `apps/web/src/pages/org/OrgLayout.tsx`

**Step 1: Create OrgLayout with role-based sidebar**

```typescript
import { useEffect, useState } from "react"
import { Outlet, Link, useNavigate, useParams, useLocation } from "react-router-dom"
import { Users, Settings, LogOut } from "lucide-react"
import { signOut, getMyProfile, type UserRole } from "@/lib/auth"

export default function OrgLayout() {
  const { neis } = useParams<{ neis: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [role, setRole] = useState<UserRole | null>(null)

  useEffect(() => {
    getMyProfile().then((p) => {
      if (p) setRole(p.role)
    })
  }, [])

  const basePath = `/${neis}/admin`
  const isSessionsActive = location.pathname === basePath || location.pathname.startsWith(`${basePath}/groups`) || location.pathname.startsWith(`${basePath}/recap`)
  const isQuestionsActive = location.pathname === `${basePath}/questions`

  const handleSignOut = async () => {
    await signOut()
    navigate(`/${neis}/admin/login`)
  }

  const title = role === "org_admin" ? "기관 관리자" : "교사"

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        </div>
        <nav className="flex-1 space-y-2">
          {role === "org_admin" ? (
            <Link to={basePath} className="flex items-center gap-3 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
              <Users className="w-5 h-5" />
              교사 관리
            </Link>
          ) : (
            <>
              <Link to={basePath} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSessionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
                <Users className="w-5 h-5" />
                세션 관리
              </Link>
              <Link to={`${basePath}/questions`} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isQuestionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
                <Settings className="w-5 h-5" />
                문제 은행
              </Link>
            </>
          )}
        </nav>
        <div className="mt-auto">
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 px-3 py-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors">
            <LogOut className="w-5 h-5" />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        <header className="h-16 border-b flex items-center px-8 bg-card shrink-0">
          <h1 className="text-xl font-semibold">대시보드</h1>
        </header>
        <div className="flex-1 p-8">
          <Outlet context={{ role }} />
        </div>
      </main>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/web/src/pages/org/OrgLayout.tsx
git commit -m "feat: add org layout with role-based sidebar navigation"
```

---

## Task 12: Update Existing Admin Components for Multi-Tenant

**Files:**
- Modify: `apps/web/src/pages/admin/AdminDashboard.tsx`
- Modify: `apps/web/src/pages/admin/AdminRoomGroup.tsx`
- Modify: `apps/web/src/pages/admin/AdminBank.tsx`

### Step 1: AdminDashboard - Add org_id filter

In `AdminDashboard.tsx`, update `fetchGroups` to filter by the current user's org:

```typescript
// Add import at top:
import { getMyProfile } from "@/lib/auth"

// Update fetchGroups:
const fetchGroups = async () => {
    const profile = await getMyProfile()
    if (!profile) return

    let query = (supabase as any).from('room_groups').select('*').order('created_at', { ascending: false })

    // If not super_admin, filter by org
    if (profile.role !== 'super_admin') {
      query = query.eq('org_id', profile.org_id)
    }

    const { data: groupData } = await query
    if (!groupData) return

    // ... rest stays the same
}
```

Also update `handleCreateGroup` to include org_id:

```typescript
const handleCreateGroup = async () => {
    const profile = await getMyProfile()
    if (!profile) return

    const name = window.prompt('새로운 세션(그룹) 이름을 입력하세요.')
    if (!name?.trim()) return

    const { data, error } = await (supabase as any).from('room_groups').insert({
      name: name.trim(),
      org_id: profile.org_id,
      created_by: profile.id,
    }).select().single()

    // ... rest stays the same
}
```

### Step 2: AdminBank - Add org_id filter

In `AdminBank.tsx`, update `fetchQuestions`:

```typescript
// Add import:
import { getMyProfile } from "@/lib/auth"

// Update fetchQuestions:
const fetchQuestions = async () => {
    const profile = await getMyProfile()
    if (!profile) return

    let query = (supabase as any).from('questions').select('*').order('created_at', { ascending: false })
    if (profile.role !== 'super_admin') {
      query = query.eq('org_id', profile.org_id)
    }

    const { data } = await query
    if (data) setQuestions(data as QuestionRow[])
}
```

Also update question creation to include org_id:

```typescript
// When creating/updating a question, include:
org_id: profile.org_id,
created_by: profile.id,
```

### Step 3: AdminRoomGroup - Update invite code generation

Replace the 6-digit code generation (appears in 2 places):

```typescript
// OLD (lines ~210-211, ~357-358):
const p1Code = Math.floor(100000 + Math.random() * 900000).toString()
const p2Code = Math.floor(100000 + Math.random() * 900000).toString()

// NEW:
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 chars, no O/I/L/0/1
function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < 7; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)]
  }
  return code
}

const p1Code = generateInviteCode()
const p2Code = generateInviteCode()
```

### Step 4: Commit

```bash
git add apps/web/src/pages/admin/AdminDashboard.tsx apps/web/src/pages/admin/AdminRoomGroup.tsx apps/web/src/pages/admin/AdminBank.tsx
git commit -m "feat: add org_id filtering to admin components + 7-char invite codes"
```

---

## Task 13: Update Home.tsx for Alphanumeric Codes

**Files:**
- Modify: `apps/web/src/pages/Home.tsx`

### Step 1: Update input validation

Replace the digit-only filter with alphanumeric uppercase:

```typescript
// OLD (line ~47):
onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
// maxLength={6}
// placeholder="1 2 3 4 5 6"
// disabled={code.length !== 6}

// NEW:
onChange={(e) => setCode(e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase())}
// maxLength={7}
// placeholder="A B C 2 3 4 5"
// disabled={code.length !== 7}
```

Also update the length check in `handleJoin`:

```typescript
// OLD:
if (code.length === 6) {
// NEW:
if (code.length === 7) {
```

Update the description text:

```typescript
// OLD:
선생님께서 알려주신 6자리 접속 코드를 입력하세요.
// NEW:
선생님께서 알려주신 7자리 접속 코드를 입력하세요.
```

### Step 2: Commit

```bash
git add apps/web/src/pages/Home.tsx
git commit -m "feat: update Home to accept 7-char alphanumeric invite codes"
```

---

## Task 14: Update roomStore.ts for New Code Format

**Files:**
- Modify: `apps/web/src/store/roomStore.ts`

### Step 1: No code change needed for roomStore

The `joinRoom` function uses `.or()` to query by invite code. Since the column type is already `TEXT`, it naturally supports alphanumeric codes. No changes needed to the query logic itself.

Verify: The `.or()` query at line ~306 works with any string format.

---

## Task 15: Update App.tsx Routing

**Files:**
- Modify: `apps/web/src/App.tsx`

### Step 1: Replace entire App.tsx

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
// Super Admin
import SuperAdminLogin from "./pages/superadmin/SuperAdminLogin"
import SuperAdminLayout from "./pages/superadmin/SuperAdminLayout"
import SuperAdminDashboard from "./pages/superadmin/SuperAdminDashboard"
import OrgDetail from "./pages/superadmin/OrgDetail"
// Org (shared admin components)
import OrgLogin from "./pages/org/OrgLogin"
import OrgLayout from "./pages/org/OrgLayout"
import OrgAdminDashboard from "./pages/org/OrgAdminDashboard"
// Shared admin components (reused by super_admin and teacher)
import AdminDashboard from "./pages/admin/AdminDashboard"
import AdminRoomGroup from "./pages/admin/AdminRoomGroup"
import AdminRecap from "./pages/admin/AdminRecap"
import AdminBank from "./pages/admin/AdminBank"
// Auth
import AuthGuard from "./components/auth/AuthGuard"
// Player
import DeviceGuard from "./components/DeviceGuard"
import Home from "./pages/Home"
import RoomWrapper from "./pages/room/RoomWrapper"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Super Admin Routes */}
        <Route path="/superadmin/login" element={<SuperAdminLogin />} />
        <Route path="/superadmin" element={
          <AuthGuard allowedRoles={["super_admin"]} redirectTo="/superadmin/login">
            <SuperAdminLayout />
          </AuthGuard>
        }>
          <Route index element={<SuperAdminDashboard />} />
          <Route path="orgs/:neisCode" element={<OrgDetail />} />
          <Route path="groups" element={<AdminDashboard />} />
          <Route path="groups/:groupId" element={<AdminRoomGroup />} />
          <Route path="recap/:roomId" element={<AdminRecap />} />
          <Route path="questions" element={<AdminBank />} />
        </Route>

        {/* Organization Routes (org_admin + teacher) */}
        <Route path="/:neis/admin/login" element={<OrgLogin />} />
        <Route path="/:neis/admin" element={
          <AuthGuard allowedRoles={["org_admin", "teacher"]} redirectTo="login">
            <OrgLayout />
          </AuthGuard>
        }>
          <Route index element={<OrgRouteIndex />} />
          <Route path="groups/:groupId" element={<AdminRoomGroup />} />
          <Route path="recap/:roomId" element={<AdminRecap />} />
          <Route path="questions" element={<AdminBank />} />
        </Route>

        {/* Public / Player Routes */}
        <Route path="/" element={<DeviceGuard><Home /></DeviceGuard>} />
        <Route path="/room/:code" element={<DeviceGuard><RoomWrapper /></DeviceGuard>} />

        {/* Legacy redirect */}
        <Route path="/admin/*" element={<Navigate to="/" replace />} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

/** Route index component: shows org_admin dashboard or teacher dashboard based on role */
function OrgRouteIndex() {
  // This uses the Outlet context from OrgLayout
  // We need to check role and render the right component
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    import("./lib/auth").then(({ getMyProfile }) => {
      getMyProfile().then((p) => setRole(p?.role || null))
    })
  }, [])

  if (!role) return null
  if (role === "org_admin") return <OrgAdminDashboard />
  return <AdminDashboard />
}
```

Note: Add the missing imports for `useState` and `useEffect` at the top.

### Step 2: Commit

```bash
git add apps/web/src/App.tsx
git commit -m "feat: update routing for multi-tenant super_admin/org/teacher pages"
```

---

## Task 16: Remove Old AdminLogin and AdminLayout

**Files:**
- Delete or repurpose: `apps/web/src/pages/admin/AdminLogin.tsx`
- Modify: `apps/web/src/pages/admin/AdminLayout.tsx`

### Step 1: AdminLogin.tsx

The old `AdminLogin.tsx` with hardcoded password is no longer needed. It's replaced by `SuperAdminLogin` and `OrgLogin`. Delete the file or keep it for reference.

### Step 2: AdminLayout.tsx

The old `AdminLayout.tsx` is replaced by `SuperAdminLayout` and `OrgLayout`. Delete or keep for reference.

### Step 3: Commit

```bash
git rm apps/web/src/pages/admin/AdminLogin.tsx apps/web/src/pages/admin/AdminLayout.tsx
git commit -m "refactor: remove old AdminLogin and AdminLayout (replaced by multi-tenant pages)"
```

---

## Task 17: Update TypeScript Types

**Files:**
- Modify: `packages/supabase/src/types.ts`

### Step 1: Add new table types

Add types for `organizations` and `profiles` to the Database type definition. If using `supabase gen types`, run:

```bash
# Generate types from the updated schema
supabase gen types typescript --db-url "postgresql://postgres:PASSWORD@localhost:15433/postgres" > packages/supabase/src/types.ts
```

### Step 2: Commit

```bash
git add packages/supabase/src/types.ts
git commit -m "feat: update TypeScript types for organizations and profiles tables"
```

---

## Task 18: Integration Testing

### Step 1: Verify super admin login

1. Navigate to `/superadmin/login`
2. Enter the password set in Task 4
3. Should redirect to `/superadmin` showing the org management dashboard

### Step 2: Create an org

1. Click "기관 추가"
2. Enter NEIS code, school name, admin password
3. Should create org and show it in the list

### Step 3: Verify org admin login

1. Navigate to `/{neis_code}/admin/login`
2. Click "기관 관리자이신가요?"
3. Enter the admin password
4. Should see teacher management dashboard

### Step 4: Create a teacher

1. Click "교사 추가"
2. Enter teacher ID, name, password
3. Should appear in teacher list

### Step 5: Verify teacher login

1. Navigate to `/{neis_code}/admin/login`
2. Enter teacher ID + password
3. Should see session management dashboard (same as old admin)

### Step 6: Verify data isolation

1. Create sessions/questions as teacher in org A
2. Login as teacher in org B
3. Should NOT see org A's data

### Step 7: Verify invite codes

1. Create a room → should get 7-char alphanumeric codes
2. Go to `/` → enter the code
3. Should join the room successfully

### Step 8: Commit final state

```bash
git add -A
git commit -m "feat: complete multi-tenant admin system implementation"
```

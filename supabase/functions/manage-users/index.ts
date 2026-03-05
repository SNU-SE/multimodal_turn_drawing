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
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

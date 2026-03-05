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

  const { data } = await (supabase as any)
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

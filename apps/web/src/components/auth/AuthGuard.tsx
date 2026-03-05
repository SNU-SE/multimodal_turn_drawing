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

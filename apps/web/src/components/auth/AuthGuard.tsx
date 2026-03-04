import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Loader2 } from "lucide-react"
import { logger } from "@/lib/logger"

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [authenticated, setAuthenticated] = useState(false)

    useEffect(() => {
        logger.info("[AuthGuard] 세션 확인 중...")

        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (error) {
                logger.error("[AuthGuard] 세션 조회 오류:", error.message)
            }

            if (session) {
                logger.info("[AuthGuard] 인증됨:", { email: session.user.email, expires: session.expires_at })
                setAuthenticated(true)
            } else {
                logger.warn("[AuthGuard] 미인증 — /admin/login으로 리다이렉트")
                navigate("/admin/login", { replace: true })
            }
            setLoading(false)
        })

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            logger.info("[AuthGuard] 인증 상태 변경:", event)

            if (!session) {
                logger.warn("[AuthGuard] 세션 만료/로그아웃 — 리다이렉트")
                setAuthenticated(false)
                navigate("/admin/login", { replace: true })
            } else {
                logger.info("[AuthGuard] 세션 유효:", { email: session.user.email })
                setAuthenticated(true)
            }
        })

        return () => {
            logger.debug("[AuthGuard] 구독 해제")
            subscription.unsubscribe()
        }
    }, [navigate])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        )
    }

    if (!authenticated) return null

    return <>{children}</>
}

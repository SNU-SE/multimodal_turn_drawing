import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { logger } from "@/lib/logger"

const SESSION_KEY = "admin_authenticated"

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate()
    const [authenticated, setAuthenticated] = useState(false)

    useEffect(() => {
        const isAuth = sessionStorage.getItem(SESSION_KEY) === "true"
        logger.info("[AuthGuard] 세션 확인:", isAuth ? "인증됨" : "미인증")

        if (isAuth) {
            setAuthenticated(true)
        } else {
            logger.warn("[AuthGuard] 미인증 — /admin/login으로 리다이렉트")
            navigate("/admin/login", { replace: true })
        }
    }, [navigate])

    if (!authenticated) return null

    return <>{children}</>
}

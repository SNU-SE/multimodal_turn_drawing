import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { logger } from "@/lib/logger"

const ADMIN_PASSWORD = "38874"
const SESSION_KEY = "admin_authenticated"

export default function AdminLogin() {
    const navigate = useNavigate()
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        logger.info("[AdminLogin] 로그인 시도")

        if (password === ADMIN_PASSWORD) {
            logger.info("[AdminLogin] 로그인 성공")
            sessionStorage.setItem(SESSION_KEY, "true")
            navigate("/admin")
        } else {
            logger.error("[AdminLogin] 로그인 실패: 비밀번호 불일치")
            setError("비밀번호가 올바르지 않습니다.")
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Card className="w-full max-w-sm shadow-lg">
                <CardContent className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="관리자 비밀번호"
                                required
                                autoComplete="current-password"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}

                        <Button type="submit" className="w-full">
                            로그인
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}

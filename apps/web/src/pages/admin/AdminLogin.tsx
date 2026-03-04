import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { logger } from "@/lib/logger"

const ADMIN_EMAIL = "admin@mail.com"

export default function AdminLogin() {
    const navigate = useNavigate()
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        logger.info("[AdminLogin] 로그인 시도:", ADMIN_EMAIL)

        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email: ADMIN_EMAIL,
                password
            })

            if (authError) {
                logger.error("[AdminLogin] 로그인 실패:", authError.message, authError.status)
                setError(`로그인 실패: ${authError.message}`)
                setLoading(false)
                return
            }

            logger.info("[AdminLogin] 로그인 성공:", { userId: data.user?.id, email: data.user?.email })
            navigate("/admin")
        } catch (err: any) {
            logger.error("[AdminLogin] 예외 발생:", err)
            setError(`오류: ${err.message}`)
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Card className="w-full max-w-sm shadow-lg">
                <CardContent className="p-8">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
                            T
                        </div>
                        <h1 className="text-xl font-bold">Admin Login</h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
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

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            로그인
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}

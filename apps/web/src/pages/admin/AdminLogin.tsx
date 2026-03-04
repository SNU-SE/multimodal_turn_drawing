import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { logger } from "@/lib/logger"

export default function AdminLogin() {
    const navigate = useNavigate()
    const [userId, setUserId] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        // ID를 이메일 형식으로 변환 (admin → admin@mail.com)
        const email = userId.includes("@") ? userId : `${userId}@mail.com`
        logger.info("[AdminLogin] 로그인 시도:", { userId, email })

        const { data, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        setLoading(false)

        if (authError) {
            logger.error("[AdminLogin] 로그인 실패:", authError.message)
            setError("아이디 또는 비밀번호가 올바르지 않습니다.")
            return
        }

        logger.info("[AdminLogin] 로그인 성공:", { userId: data.user?.id, email: data.user?.email })
        navigate("/admin")
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
                            <Label htmlFor="userId">ID</Label>
                            <Input
                                id="userId"
                                type="text"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                placeholder="admin"
                                required
                                autoComplete="username"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
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

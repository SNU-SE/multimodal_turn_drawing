import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Home() {
    const [code, setCode] = useState("")
    const navigate = useNavigate()

    const handleJoin = (e: React.FormEvent) => {
        e.preventDefault()
        if (code.length === 6) {
            navigate(`/room/${code}`)
        }
    }

    return (
        <div className="relative min-h-screen flex items-center justify-center bg-background p-4">

            {/* Mobile Portrait Block */}
            <div className="hidden max-md:portrait:flex absolute inset-0 bg-background z-50 flex-col items-center justify-center p-8 text-center gap-4">
                <div className="text-5xl">📱</div>
                <h2 className="text-2xl font-bold">세로 모드 접속 불가</h2>
                <p className="text-muted-foreground">
                    이 플랫폼은 <strong>태블릿 또는 PC 가로 모드</strong> 전용입니다.<br />
                    기기를 가로로 회전하거나 PC에서 접속해주세요.
                </p>
            </div>

            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">협력 드로잉 플랫폼</CardTitle>
                    <CardDescription>
                        관리자에게 부여받은 6자리 접속 코드를 입력하세요.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleJoin} className="space-y-4">
                        <div className="space-y-2">
                            <Input
                                type="text"
                                placeholder="Ex. 123456"
                                className="text-center text-2xl tracking-widest h-14"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            />
                        </div>
                        <Button
                            type="submit"
                            className="w-full h-12 text-lg bg-primary hover:bg-primary/90"
                            disabled={code.length !== 6}
                        >
                            입장하기
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}

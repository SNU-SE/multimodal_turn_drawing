import { useState, useEffect } from "react"

const MIN_WIDTH = 768

export default function DeviceGuard({ children }: { children: React.ReactNode }) {
    const [blocked, setBlocked] = useState(false)

    useEffect(() => {
        const check = () => setBlocked(window.innerWidth < MIN_WIDTH)
        check()
        window.addEventListener("resize", check)
        window.addEventListener("orientationchange", () => setTimeout(check, 100))
        return () => {
            window.removeEventListener("resize", check)
            window.removeEventListener("orientationchange", () => setTimeout(check, 100))
        }
    }, [])

    if (blocked) {
        return (
            <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
                    <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold mb-3">PC 또는 태블릿을 사용해주세요</h2>
                <p className="text-muted-foreground max-w-sm">
                    이 플랫폼은 가로 모드(Landscape) 태블릿 또는 PC에서만 사용할 수 있습니다.
                    768px 이상의 화면이 필요합니다.
                </p>
            </div>
        )
    }

    return <>{children}</>
}

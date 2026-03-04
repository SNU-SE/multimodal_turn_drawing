import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { Users, Settings, LogOut } from "lucide-react"
import { logger } from "@/lib/logger"

const SESSION_KEY = "admin_authenticated"

export default function AdminLayout() {
    const navigate = useNavigate()
    const location = useLocation()

    const isSessionsActive = location.pathname === '/admin' || location.pathname.startsWith('/admin/groups') || location.pathname.startsWith('/admin/recap')
    const isQuestionsActive = location.pathname === '/admin/questions'

    const handleSignOut = () => {
        logger.info("[AdminLayout] 로그아웃")
        sessionStorage.removeItem(SESSION_KEY)
        navigate("/admin/login")
    }

    return (
        <div className="flex h-screen w-full bg-background text-foreground">
            {/* Sidebar */}
            <aside className="w-64 border-r border-border bg-card p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">
                        T
                    </div>
                    <h2 className="text-xl font-bold tracking-tight">Admin Panel</h2>
                </div>

                <nav className="flex-1 space-y-2">
                    <Link to="/admin" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSessionsActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'}`}>
                        <Users className="w-5 h-5" />
                        세션 관리 (Sessions)
                    </Link>
                    <Link to="/admin/questions" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isQuestionsActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'}`}>
                        <Settings className="w-5 h-5" />
                        문제 은행 (Bank)
                    </Link>
                </nav>

                <div className="mt-auto">
                    <button
                        onClick={handleSignOut}
                        className="flex w-full items-center gap-3 px-3 py-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign out
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-auto">
                <header className="h-16 border-b flex items-center px-8 bg-card shrink-0">
                    <h1 className="text-xl font-semibold">대시보드</h1>
                </header>
                <div className="flex-1 p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    )
}

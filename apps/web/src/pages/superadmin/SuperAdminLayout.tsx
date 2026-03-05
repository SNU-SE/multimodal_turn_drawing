import { Outlet, Link, useNavigate, useLocation } from "react-router-dom"
import { Building2, Users, Settings, LogOut } from "lucide-react"
import { signOut } from "@/lib/auth"

export default function SuperAdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const isOrgsActive = location.pathname === "/superadmin" || location.pathname.startsWith("/superadmin/orgs")
  const isSessionsActive = location.pathname.startsWith("/superadmin/groups") || location.pathname.startsWith("/superadmin/recap")
  const isQuestionsActive = location.pathname === "/superadmin/questions"

  const handleSignOut = async () => {
    await signOut()
    navigate("/superadmin/login")
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <h2 className="text-xl font-bold tracking-tight">전체 관리자</h2>
        </div>
        <nav className="flex-1 space-y-2">
          <Link to="/superadmin" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isOrgsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Building2 className="w-5 h-5" />
            기관 관리
          </Link>
          <Link to="/superadmin/groups" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSessionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Users className="w-5 h-5" />
            세션 관리
          </Link>
          <Link to="/superadmin/questions" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isQuestionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
            <Settings className="w-5 h-5" />
            문제 은행
          </Link>
        </nav>
        <div className="mt-auto">
          <button onClick={handleSignOut} className="flex w-full items-center gap-3 px-3 py-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors">
            <LogOut className="w-5 h-5" />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        <header className="h-16 border-b flex items-center px-8 bg-card shrink-0">
          <h1 className="text-xl font-semibold">전체 관리자 대시보드</h1>
        </header>
        <div className="flex-1 p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

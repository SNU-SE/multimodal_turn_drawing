import { useEffect, useState } from "react"
import { Outlet, Link, useNavigate, useParams, useLocation } from "react-router-dom"
import { Users, Settings, LogOut } from "lucide-react"
import { signOut, getMyProfile, type UserRole } from "@/lib/auth"

export default function OrgLayout() {
  const { neis } = useParams<{ neis: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [role, setRole] = useState<UserRole | null>(null)

  useEffect(() => {
    getMyProfile().then((p) => {
      if (p) setRole(p.role)
    })
  }, [])

  const basePath = `/${neis}/admin`
  const isSessionsActive = location.pathname === basePath || location.pathname.startsWith(`${basePath}/groups`) || location.pathname.startsWith(`${basePath}/recap`)
  const isQuestionsActive = location.pathname === `${basePath}/questions`

  const handleSignOut = async () => {
    await signOut()
    navigate(`/${neis}/admin/login`)
  }

  const title = role === "org_admin" ? "기관 관리자" : "교사"

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        </div>
        <nav className="flex-1 space-y-2">
          {role === "org_admin" ? (
            <Link to={basePath} className="flex items-center gap-3 px-3 py-2 rounded-md bg-primary/10 text-primary font-medium">
              <Users className="w-5 h-5" />
              교사 관리
            </Link>
          ) : (
            <>
              <Link to={basePath} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isSessionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
                <Users className="w-5 h-5" />
                세션 관리
              </Link>
              <Link to={`${basePath}/questions`} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${isQuestionsActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"}`}>
                <Settings className="w-5 h-5" />
                문제 은행
              </Link>
            </>
          )}
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
          <h1 className="text-xl font-semibold">대시보드</h1>
        </header>
        <div className="flex-1 p-8">
          <Outlet context={{ role }} />
        </div>
      </main>
    </div>
  )
}

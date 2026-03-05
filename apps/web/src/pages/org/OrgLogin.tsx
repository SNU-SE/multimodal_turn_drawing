import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { signInOrgAdmin, signInTeacher } from "@/lib/auth"

export default function OrgLogin() {
  const { neis } = useParams<{ neis: string }>()
  const navigate = useNavigate()
  const [isOrgAdminMode, setIsOrgAdminMode] = useState(false)
  const [teacherId, setTeacherId] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!neis) return
    setLoading(true)
    setError(null)

    const { error: authError } = await signInTeacher(teacherId, neis, password)
    if (authError) {
      setError("ID 또는 비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    navigate(`/${neis}/admin`)
  }

  const handleOrgAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!neis) return
    setLoading(true)
    setError(null)

    const { error: authError } = await signInOrgAdmin(neis, password)
    if (authError) {
      setError("비밀번호가 올바르지 않습니다.")
      setLoading(false)
      return
    }
    navigate(`/${neis}/admin`)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">관리자 로그인</CardTitle>
          <CardDescription>기관 코드: {neis}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOrgAdminMode ? (
            <form onSubmit={handleTeacherLogin} className="space-y-4">
              <Input
                placeholder="교사 ID"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                required
                autoFocus
              />
              <Input
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "로그인 중..." : "교사 로그인"}
              </Button>
              <button
                type="button"
                onClick={() => { setIsOrgAdminMode(true); setError(null); setPassword("") }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                기관 관리자이신가요?
              </button>
            </form>
          ) : (
            <form onSubmit={handleOrgAdminLogin} className="space-y-4">
              <Input
                type="password"
                placeholder="기관 관리자 비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "로그인 중..." : "기관 관리자 로그인"}
              </Button>
              <button
                type="button"
                onClick={() => { setIsOrgAdminMode(false); setError(null); setPassword("") }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                교사 로그인으로 돌아가기
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

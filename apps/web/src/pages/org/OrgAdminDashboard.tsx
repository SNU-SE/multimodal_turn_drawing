import { useEffect, useState } from "react"
import { manageUsers, getMyProfile } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, Trash2, KeyRound } from "lucide-react"

interface Teacher {
  id: string
  display_name: string
  created_at: string
}

export default function OrgAdminDashboard() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [teacherId, setTeacherId] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const fetchTeachers = async () => {
    const profile = await getMyProfile()
    if (!profile) return
    const data = await manageUsers({ action: "list_teachers", orgId: profile.org_id })
    setTeachers(data.teachers || [])
  }

  useEffect(() => { fetchTeachers() }, [])

  const handleCreateTeacher = async () => {
    if (!teacherId || !displayName || !password) return
    setLoading(true)
    try {
      await manageUsers({
        action: "create_teacher",
        teacherId,
        displayName,
        password,
      })
      setIsCreateOpen(false)
      setTeacherId("")
      setDisplayName("")
      setPassword("")
      fetchTeachers()
    } catch (err: any) {
      alert(`교사 생성 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteTeacher = async (userId: string, name: string) => {
    if (!confirm(`${name} 교사를 삭제하시겠습니까?`)) return
    try {
      await manageUsers({ action: "delete_user", userId })
      fetchTeachers()
    } catch (err: any) {
      alert(`삭제 실패: ${err.message}`)
    }
  }

  const handleResetPassword = async (userId: string) => {
    const newPw = prompt("새 비밀번호를 입력하세요:")
    if (!newPw) return
    try {
      await manageUsers({ action: "update_password", userId, newPassword: newPw })
      alert("비밀번호가 변경되었습니다.")
    } catch (err: any) {
      alert(`변경 실패: ${err.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">교사 관리</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />교사 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>교사 계정 생성</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input placeholder="교사 ID (영문+숫자)" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} />
              <Input placeholder="표시 이름" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <Input type="password" placeholder="초기 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button onClick={handleCreateTeacher} className="w-full" disabled={loading}>
                {loading ? "생성 중..." : "생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>등록된 교사 ({teachers.length}명)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">이름</th>
                <th className="text-left py-2">등록일</th>
                <th className="text-right py-2">관리</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">{t.display_name}</td>
                  <td className="py-2">{new Date(t.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2 text-right space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleResetPassword(t.id)}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteTeacher(t.id, t.display_name)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

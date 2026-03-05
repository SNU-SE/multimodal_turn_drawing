import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { manageUsers } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus } from "lucide-react"

interface Org {
  id: string
  neis_code: string
  name: string
  created_at: string
  teacherCount: number
  sessionCount: number
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [neisCode, setNeisCode] = useState("")
  const [orgName, setOrgName] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const fetchOrgs = async () => {
    const { data: orgData } = await (supabase as any)
      .from("organizations")
      .select("*")
      .neq("neis_code", "0000000") // Exclude super_admin org
      .order("created_at", { ascending: false })

    if (!orgData) return

    // Get teacher counts and session counts per org
    const { data: profileData } = await (supabase as any)
      .from("profiles")
      .select("org_id")
      .eq("role", "teacher")

    const { data: groupData } = await (supabase as any)
      .from("room_groups")
      .select("org_id")

    const mapped = orgData.map((o: any) => ({
      ...o,
      teacherCount: profileData?.filter((p: any) => p.org_id === o.id).length || 0,
      sessionCount: groupData?.filter((g: any) => g.org_id === o.id).length || 0,
    }))

    setOrgs(mapped)
  }

  useEffect(() => { fetchOrgs() }, [])

  const handleCreateOrg = async () => {
    if (!neisCode || !orgName || !adminPassword) return
    setLoading(true)
    try {
      await manageUsers({
        action: "create_org",
        neisCode,
        orgName,
        adminPassword,
      })
      setIsCreateOpen(false)
      setNeisCode("")
      setOrgName("")
      setAdminPassword("")
      fetchOrgs()
    } catch (err: any) {
      alert(`기관 생성 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">기관 목록</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />기관 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 기관 추가</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input placeholder="NEIS 행정표준코드 (7자리)" value={neisCode} onChange={(e) => setNeisCode(e.target.value)} maxLength={7} />
              <Input placeholder="학교/기관명" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              <Input type="password" placeholder="기관 관리자 비밀번호" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
              <Button onClick={handleCreateOrg} className="w-full" disabled={loading}>
                {loading ? "생성 중..." : "생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {orgs.map((org) => (
          <Card key={org.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/superadmin/orgs/${org.neis_code}`)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{org.name}</CardTitle>
              <p className="text-sm text-muted-foreground">NEIS: {org.neis_code}</p>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm">
                <span>교사 {org.teacherCount}명</span>
                <span>세션 {org.sessionCount}개</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                접속 URL: /{org.neis_code}/admin
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

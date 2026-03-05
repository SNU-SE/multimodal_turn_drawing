import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import * as XLSX from "xlsx"

export default function OrgDetail() {
  const { neisCode } = useParams<{ neisCode: string }>()
  const [org, setOrg] = useState<any>(null)
  const [teachers, setTeachers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])

  useEffect(() => {
    const fetchData = async () => {
      // Get org
      const { data: orgData } = await (supabase as any)
        .from("organizations")
        .select("*")
        .eq("neis_code", neisCode!)
        .single()
      if (!orgData) return
      setOrg(orgData)

      // Get teachers
      const { data: teacherData } = await (supabase as any)
        .from("profiles")
        .select("*")
        .eq("org_id", orgData.id)
        .eq("role", "teacher")
        .order("created_at")
      setTeachers(teacherData || [])

      // Get sessions with room counts
      const { data: groupData } = await (supabase as any)
        .from("room_groups")
        .select("*")
        .eq("org_id", orgData.id)
        .order("created_at", { ascending: false })

      const { data: roomData } = await (supabase as any)
        .from("rooms")
        .select("id, group_id, status")

      const mapped = (groupData || []).map((g: any) => {
        const grpRooms = (roomData || []).filter((r: any) => r.group_id === g.id)
        return {
          ...g,
          total: grpRooms.length,
          pending: grpRooms.filter((r: any) => r.status === "pending").length,
          playing: grpRooms.filter((r: any) => r.status === "playing").length,
          completed: grpRooms.filter((r: any) => r.status === "completed").length,
        }
      })
      setSessions(mapped)
    }
    fetchData()
  }, [neisCode])

  const handleDownload = async () => {
    // Download all session data for this org as Excel
    const rows: any[] = []
    for (const session of sessions) {
      const { data: rooms } = await (supabase as any)
        .from("rooms")
        .select("*, room_questions(*, questions(*))")
        .eq("group_id", session.id)

      for (const room of rooms || []) {
        for (const rq of (room as any).room_questions || []) {
          rows.push({
            세션명: session.name,
            방코드: room.code,
            문제: rq.questions?.title || rq.question_id,
            제출답안: rq.submitted_answer,
            정답여부: rq.is_correct,
          })
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "데이터")
    XLSX.writeFile(wb, `${org?.name || neisCode}_data.xlsx`)
  }

  if (!org) return <div>로딩 중...</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">{org.name}</h2>
          <p className="text-muted-foreground">NEIS: {org.neis_code}</p>
        </div>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-2" />전체 데이터 다운로드
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>교사 목록 ({teachers.length}명)</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th className="text-left py-2">이름</th><th className="text-left py-2">등록일</th></tr></thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">{t.display_name}</td>
                  <td className="py-2">{new Date(t.created_at).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>세션 현황 ({sessions.length}개)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    대기 {s.pending} | 진행 {s.playing} | 완료 {s.completed} | 전체 {s.total}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

import { Link, useNavigate } from "react-router-dom"
import { Users, PlayCircle, CheckCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { logger } from "@/lib/logger"

interface GroupStats {
    id: string
    name: string
    total: number
    pending: number
    playing: number
    completed: number
}

export default function AdminDashboard() {
    const [groups, setGroups] = useState<GroupStats[]>([])
    const navigate = useNavigate()

    const fetchGroups = async () => {
        logger.info("Admin fetching room groups...")
        const { data: groupData } = await (supabase as any).from('room_groups').select('*').order('created_at', { ascending: false })
        if (!groupData) return

        const { data: roomData } = await (supabase as any).from('rooms').select('id, group_id, status')

        const mapped = (groupData as any[]).map(g => {
            const grpRooms = (roomData as any[])?.filter(r => r.group_id === g.id) || []
            return {
                ...g,
                total: grpRooms.length,
                pending: grpRooms.filter(r => r.status === 'pending').length,
                playing: grpRooms.filter(r => r.status === 'playing').length,
                completed: grpRooms.filter(r => r.status === 'completed').length,
            }
        })
        setGroups(mapped)
    }

    useEffect(() => {
        fetchGroups()
    }, [])

    const handleCreateGroup = async () => {
        const name = window.prompt('새로운 세션(그룹) 이름을 입력하세요. (예: 1차 실습)')
        if (!name || !name.trim()) return

        logger.info(`Creating new group: ${name}`)
        const { data, error } = await (supabase as any).from('room_groups').insert({ name: name.trim() }).select().single()

        if (error || !data) {
            logger.error("Failed to create group", error)
            alert('그룹 생성에 실패했습니다.')
            return
        }

        // Navigate directly to the newly created group to upload excel
        navigate(`/admin/groups/${data.id}`)
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">세션 관리</h2>
                    <p className="text-muted-foreground">생성된 방 그룹과 진행 현황을 모니터링합니다.</p>
                </div>
                <Button onClick={handleCreateGroup} className="bg-primary hover:bg-primary/90">
                    + 새로운 세션(방) 생성
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {groups.map((group) => (
                    <Link key={group.id} to={`/admin/groups/${group.id}`}>
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                            <CardHeader className="pb-2">
                                <CardTitle>{group.name}</CardTitle>
                                <CardDescription>총 {group.total}팀 참여</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4 mt-4">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-muted-foreground" />
                                        <div className="text-sm">
                                            <p className="text-muted-foreground">대기중</p>
                                            <p className="font-medium">{group.pending}팀</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <PlayCircle className="w-4 h-4 text-primary" />
                                        <div className="text-sm">
                                            <p className="text-muted-foreground">진행중</p>
                                            <p className="font-medium text-primary">{group.playing}팀</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                        <div className="text-sm">
                                            <p className="text-muted-foreground">완료됨</p>
                                            <p className="font-medium">{group.completed}팀</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4 text-muted-foreground" />
                                        <div className="text-sm">
                                            <p className="text-muted-foreground">전체</p>
                                            <p className="font-medium">{group.total}팀</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    )
}

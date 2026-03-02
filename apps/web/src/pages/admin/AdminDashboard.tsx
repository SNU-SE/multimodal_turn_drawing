import { Link } from "react-router-dom"
import { Users, PlayCircle, CheckCircle, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Mock Data
const MOCK_GROUPS = [
    { id: "1", name: "1차 실습", total: 10, pending: 2, playing: 5, completed: 3 },
    { id: "2", name: "A팀 그룹", total: 8, pending: 8, playing: 0, completed: 0 },
    { id: "3", name: "신입사원 팀빌딩", total: 15, pending: 0, playing: 0, completed: 15 },
]

export default function AdminDashboard() {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">세션 관리</h2>
                    <p className="text-muted-foreground">생성된 방 그룹과 진행 현황을 모니터링합니다.</p>
                </div>
                <Button className="bg-primary hover:bg-primary/90">
                    + 새로운 세션(방) 생성
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {MOCK_GROUPS.map((group) => (
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

import { Link } from "react-router-dom"
import { ArrowLeft, Download, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const MOCK_ROOMS = [
    { id: "r1", code: "748301", p1: "A팀 홍길동", p2: "A팀 이순신", status: "completed", turn: "완료됨", question: "5/5" },
    { id: "r2", code: "192834", p1: "A팀 강감찬", p2: "A팀 유관순", status: "playing", turn: "Player 1 (45초)", question: "2/5" },
    { id: "r3", code: "567123", p1: "A팀 안중근", p2: "A팀 윤봉길", status: "pending", turn: "대기중", question: "0/5" },
]

export default function AdminRoomGroup() {
    // const { groupId } = useParams()

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <Link to="/admin" className="p-2 hover:bg-muted rounded-md transition-colors">
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                </Link>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">A팀 그룹 상세</h2>
                    <p className="text-muted-foreground">이 그룹의 모든 턴제 드로잉 세션을 한눈에 봅니다.</p>
                </div>
            </div>

            <div className="flex justify-between items-center bg-card p-4 rounded-lg border">
                <div className="flex gap-4">
                    <div className="text-sm">
                        <p className="text-muted-foreground mb-1">총 세션</p>
                        <p className="text-2xl font-bold">12</p>
                    </div>
                    <div className="text-sm border-l pl-4">
                        <p className="text-muted-foreground mb-1">진행중</p>
                        <p className="text-2xl font-bold text-primary">5</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2">
                        <Download className="w-4 h-4" />
                        엑셀 결과 다운로드
                    </Button>
                    <Button className="bg-primary hover:bg-primary/90 gap-2">
                        <Plus className="w-4 h-4" />
                        방 추가(엑셀 템플릿)
                    </Button>
                </div>
            </div>

            <div className="border rounded-md bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>방 코드</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead>진행 단계</TableHead>
                            <TableHead>참가자 현황</TableHead>
                            <TableHead>현재 턴 시간</TableHead>
                            <TableHead className="text-right">액션</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {MOCK_ROOMS.map((room) => (
                            <TableRow key={room.id}>
                                <TableCell className="font-medium font-mono text-lg">{room.code}</TableCell>
                                <TableCell>
                                    {room.status === "completed" && <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">완료</Badge>}
                                    {room.status === "playing" && <Badge className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">진행중</Badge>}
                                    {room.status === "pending" && <Badge variant="outline" className="text-muted-foreground">대기중</Badge>}
                                </TableCell>
                                <TableCell>{room.question}</TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1 text-sm">
                                        <span className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-red-500"></span> {room.p1}
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span> {room.p2}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className={room.status === 'playing' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                                        {room.turn}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Link to={`/admin/recap/${room.id}`}>
                                        <Button variant="ghost" size="sm">
                                            {room.status === "completed" ? "리캡 보기" : "실시간 관전"}
                                        </Button>
                                    </Link>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

        </div>
    )
}

import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Download, Upload, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"
import type { Database } from "@turn-based-drawing/supabase"
import { logger } from "@/lib/logger"
import * as XLSX from "xlsx"

type RoomRow = Database['public']['Tables']['rooms']['Row']

export default function AdminRoomGroup() {
    const { groupId } = useParams()
    const [rooms, setRooms] = useState<RoomRow[]>([])
    const [groupName, setGroupName] = useState("...")
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const fetchGroupData = async () => {
        if (!groupId) return

        logger.info(`Admin fetching rooms for group: ${groupId}`)
        // Fetch group name
        const { data: groupData } = await (supabase as any)
            .from('room_groups')
            .select('name')
            .eq('id', groupId)
            .single()

        if (groupData) {
            setGroupName(groupData.name)
        }

        // Fetch rooms
        const { data } = await (supabase as any)
            .from('rooms')
            .select('*')
            .eq('group_id', groupId)
            .order('created_at', { ascending: false })

        if (data) {
            logger.info(`Admin fetched ${data.length} rooms successfully.`)
            setRooms(data as RoomRow[])
        }
    }

    useEffect(() => {
        fetchGroupData()
    }, [groupId])

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !groupId) return

        setIsUploading(true)
        logger.info("Parsing excel file...")

        const reader = new FileReader()
        reader.onload = async (event) => {
            try {
                const bstr = event.target?.result
                const wb = XLSX.read(bstr, { type: 'binary' })
                const wsname = wb.SheetNames[0]
                const ws = wb.Sheets[wsname]

                const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][]

                const rows = data.slice(1).filter(r => r.length >= 1)

                logger.info(`Found ${rows.length} valid rows to import.`)

                // Fetch up to 5 questions to use for these rooms
                const { data: qData } = await (supabase as any)
                    .from('questions')
                    .select('id')
                    .limit(5)
                const bankQuestions = qData || []

                if (bankQuestions.length === 0) {
                    alert("문제 은행에 등록된 문제가 없습니다. 먼저 문제를 등록해주세요!")
                    setIsUploading(false)
                    if (fileInputRef.current) fileInputRef.current.value = ""
                    return
                }

                let successCount = 0

                for (const row of rows) {
                    const roomCodeName = String(row[0] || '').trim()
                    const p1Alias = String(row[1] || '익명1').trim()
                    const p2Alias = String(row[2] || '익명2').trim()

                    const p1Id = crypto.randomUUID()
                    const p2Id = crypto.randomUUID()
                    const p1Code = Math.floor(100000 + Math.random() * 900000).toString()
                    const p2Code = Math.floor(100000 + Math.random() * 900000).toString()

                    // Insert users
                    const { error: userError } = await (supabase as any).from('users').insert([
                        { id: p1Id, admin_alias: p1Alias },
                        { id: p2Id, admin_alias: p2Alias }
                    ])

                    if (userError) {
                        logger.error("Error creating users:", userError)
                        continue
                    }

                    // Insert room (we store the friendly room name in 'code')
                    const { data: roomData, error: roomError } = await (supabase as any).from('rooms').insert({
                        group_id: groupId,
                        code: roomCodeName,
                        player1_id: p1Id,
                        player2_id: p2Id,
                        player1_invite_code: p1Code,
                        player2_invite_code: p2Code,
                        status: 'pending'
                    }).select().single()

                    if (roomError || !roomData) {
                        logger.error("Room insert error:", roomError)
                        continue
                    }

                    // Map questions to room
                    const roomQuestions = bankQuestions.map((q: any) => ({
                        room_id: roomData.id,
                        question_id: q.id
                    }))

                    await (supabase as any).from('room_questions').insert(roomQuestions)

                    successCount++
                }

                alert(`${successCount}개의 세션이 성공적으로 생성되었습니다.`)
                fetchGroupData()
            } catch (err) {
                logger.error("Excel mapping failed", err)
                alert("엑셀 파일을 처리하는 중 오류가 발생했습니다.")
            } finally {
                setIsUploading(false)
                if (fileInputRef.current) fileInputRef.current.value = ""
            }
        }
        reader.readAsBinaryString(file)
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <Link to="/admin" className="p-2 hover:bg-muted rounded-md transition-colors">
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                </Link>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{groupName}</h2>
                    <p className="text-muted-foreground">이 그룹의 모든 턴제 드로잉 세션을 한눈에 봅니다.</p>
                </div>
            </div>

            <div className="flex justify-between items-center bg-card p-4 rounded-lg border">
                <div className="flex gap-4">
                    <div className="text-sm">
                        <p className="text-muted-foreground mb-1">총 세션</p>
                        <p className="text-2xl font-bold">{rooms.length}</p>
                    </div>
                    <div className="text-sm border-l pl-4">
                        <p className="text-muted-foreground mb-1">진행중</p>
                        <p className="text-2xl font-bold text-primary">{rooms.filter(r => r.status === 'playing').length}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2">
                        <Download className="w-4 h-4" />
                        엑셀 결과 다운로드
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        hidden
                        accept=".xlsx, .xls, .csv"
                        onChange={handleFileUpload}
                    />
                    <Button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="bg-primary hover:bg-primary/90 gap-2"
                    >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        방 추가(엑셀 템플릿)
                    </Button>
                </div>
            </div>

            <div className="border rounded-md bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>방 식별자(조 이름)</TableHead>
                            <TableHead>Player 1 접속코드</TableHead>
                            <TableHead>Player 2 접속코드</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead>진행 단계</TableHead>
                            <TableHead>참가자 현황</TableHead>
                            <TableHead>현재 턴 시간</TableHead>
                            <TableHead className="text-right">액션</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rooms.map((room) => (
                            <TableRow key={room.id}>
                                <TableCell className="font-medium">{room.code || '-'}</TableCell>
                                <TableCell className="font-mono text-lg text-primary">{room.player1_invite_code}</TableCell>
                                <TableCell className="font-mono text-lg text-blue-600">{room.player2_invite_code}</TableCell>
                                <TableCell>
                                    {room.status === "completed" && <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">완료</Badge>}
                                    {room.status === "playing" && <Badge className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">진행중</Badge>}
                                    {room.status === "pending" && <Badge variant="outline" className="text-muted-foreground">대기중</Badge>}
                                </TableCell>
                                <TableCell>{room.current_question_index + 1} / 5</TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1 text-sm">
                                        <span className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-red-500"></span> {room.player1_id ? 'P1 배정완료' : '대기중'}
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span> {room.player2_id ? 'P2 배정완료' : '대기중'}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className={room.status === 'playing' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                                        {room.status === 'completed' ? '완료됨' : '대기중 혹은 진행'}
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

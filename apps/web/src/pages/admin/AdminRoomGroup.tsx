import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Download, Upload, Loader2, Trash2, Settings, PlusCircle, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { supabase } from "@/lib/supabase"
import type { Database } from "@turn-based-drawing/supabase"
import { logger } from "@/lib/logger"
import * as XLSX from "xlsx"

type RoomRow = Database['public']['Tables']['rooms']['Row']

export default function AdminRoomGroup() {
    const { groupId } = useParams()
    const [rooms, setRooms] = useState<RoomRow[]>([])
    const [groupName, setGroupName] = useState("...")
    const [groupQuestionIds, setGroupQuestionIds] = useState<string[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Question Selection State
    const [isSelectModalOpen, setIsSelectModalOpen] = useState(false)
    const [bankQuestions, setBankQuestions] = useState<any[]>([])
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([])
    const [isSavingQuestions, setIsSavingQuestions] = useState(false)

    const fetchGroupData = async () => {
        if (!groupId) return

        logger.info(`Admin fetching rooms for group: ${groupId}`)
        // Fetch group info (including newly added question_ids)
        const { data: groupData } = await (supabase as any)
            .from('room_groups')
            .select('name, question_ids')
            .eq('id', groupId)
            .single()

        if (groupData) {
            setGroupName(groupData.name)
            setGroupQuestionIds(groupData.question_ids || [])
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

    const fetchBankQuestions = async () => {
        const { data } = await (supabase as any).from('questions').select('id, title, question_type, image_url, correct_answer').order('created_at', { ascending: false })
        if (data) setBankQuestions(data)
    }

    const handleSaveQuestions = async () => {
        setIsSavingQuestions(true)
        try {
            await (supabase as any).from('room_groups').update({ question_ids: selectedQuestionIds }).eq('id', groupId)
            setGroupQuestionIds(selectedQuestionIds)
            setIsSelectModalOpen(false)
            alert("출제 문제가 성공적으로 저장되었습니다. 이제 엑셀로 반을 생성할 수 있습니다.")
        } catch (error) {
            console.error(error)
            alert("저장 중 오류가 발생했습니다.")
        } finally {
            setIsSavingQuestions(false)
        }
    }

    const toggleQuestionSelection = (id: string) => {
        setSelectedQuestionIds(prev =>
            prev.includes(id) ? prev.filter(q => q !== id) : [...prev, id]
        )
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

                // Group questions already exist in groupQuestionIds
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

                    // Map the group's predefined questions to the newly created room
                    const roomQuestions = groupQuestionIds.map((qId: string) => ({
                        room_id: roomData.id,
                        question_id: qId
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

    const deleteRoom = async (roomId: string) => {
        if (!confirm("이 방을 정말 삭제하시겠습니까? 방에 소속된 학생들의 정보도 모두 삭제됩니다.")) return

        try {
            await (supabase as any).from('rooms').delete().eq('id', roomId)
            setRooms(prev => prev.filter(r => r.id !== roomId))
        } catch (e) {
            console.error("Failed to delete room", e)
        }
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
                    <Button
                        onClick={() => {
                            setSelectedQuestionIds(groupQuestionIds)
                            setIsSelectModalOpen(true)
                            fetchBankQuestions()
                        }}
                        variant="secondary"
                        className="gap-2"
                    >
                        <Settings className="w-4 h-4" />
                        출제할 문제 변경 ({groupQuestionIds.length}개)
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
                                <TableCell>
                                    {room.current_question_index + 1} / {groupQuestionIds.length > 0 ? groupQuestionIds.length : '-'}
                                </TableCell>
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
                                    <div className="flex justify-end gap-2">
                                        <Link to={`/admin/recap/${room.id}`}>
                                            <Button variant="ghost" size="sm">
                                                {room.status === "completed" ? "리캡 보기" : "실시간 관전"}
                                            </Button>
                                        </Link>
                                        <Button variant="ghost" size="sm" onClick={() => deleteRoom(room.id)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Question Selection Modal */}
            <Dialog open={isSelectModalOpen} onOpenChange={setIsSelectModalOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>이 그룹에서 출제할 문제 선택</DialogTitle>
                        <DialogDescription>
                            학생들에게 출제할 문제들을 문제 은행에서 선택해주세요. (선택하지 않거나, 원하는 개수만큼 자유롭게 선택 가능)
                        </DialogDescription>
                    </DialogHeader>

                    <div className="sticky top-0 bg-background py-3 mb-2 border-b flex justify-between items-center z-10">
                        <span className="font-bold">
                            선택된 문제: <span className="text-primary">{selectedQuestionIds.length}</span>개
                        </span>
                        {bankQuestions.length < 5 && (
                            <Link to="/admin/questions">
                                <Button variant="outline" size="sm" className="gap-2">
                                    <PlusCircle className="w-4 h-4" />
                                    문제 은행에 문제 만들러 가기
                                </Button>
                            </Link>
                        )}
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 py-4">
                        {bankQuestions.length === 0 && (
                            <div className="col-span-full py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                                등록된 문제가 없습니다. 좌측 "문제 은행" 메뉴에서 먼저 이미지를 등록해주세요.
                            </div>
                        )}
                        {bankQuestions.map((q) => {
                            const isSelected = selectedQuestionIds.includes(q.id)
                            return (
                                <div
                                    key={q.id}
                                    className={`relative border rounded-lg overflow-hidden cursor-pointer transition-all ${isSelected ? 'ring-2 ring-primary border-primary shadow-sm' : 'hover:border-primary/50'}`}
                                    onClick={() => toggleQuestionSelection(q.id)}
                                >
                                    <div className="aspect-video w-full bg-muted flex items-center justify-center">
                                        <img src={q.image_url} alt="Question" className="object-cover w-full h-full opacity-90" />
                                    </div>
                                    <div className="p-3 bg-card border-t flex justify-between items-center">
                                        <div className="truncate pr-2">
                                            <p className="font-semibold text-sm truncate">{q.title || q.correct_answer}</p>
                                            <p className="text-xs text-muted-foreground">{q.question_type === 'essay' ? '주관식' : '객관식'}</p>
                                        </div>
                                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'}`}>
                                            {isSelected && <Check className="w-3 h-3" />}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <DialogFooter className="sticky bottom-0 bg-background pt-2 border-t">
                        <Button
                            onClick={handleSaveQuestions}
                            disabled={isSavingQuestions}
                            className="bg-primary flex-1"
                        >
                            {isSavingQuestions && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            선택 문제 확정 저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

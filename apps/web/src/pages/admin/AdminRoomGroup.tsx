import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, ArrowUp, ArrowDown, Download, Upload, Loader2, Trash2, Settings, PlusCircle, Clock, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { supabase } from "@/lib/supabase"
import type { Database } from "@turn-based-drawing/supabase"
import { logger } from "@/lib/logger"
import * as XLSX from "xlsx"

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 31 chars, no O/I/L/0/1
function generateInviteCode(): string {
    let code = ''
    for (let i = 0; i < 7; i++) {
        code += CHARSET[Math.floor(Math.random() * CHARSET.length)]
    }
    return code
}

type RoomRow = Database['public']['Tables']['rooms']['Row']

const EVENT_TYPE_LABELS: Record<string, string> = {
    turn_start: '턴 시작', turn_end: '턴 종료', timer_expired: '타이머 만료',
    answer_submitted: '답안 제출', question_advanced: '다음 문제 이동',
    question_back: '이전 문제 이동', retry_requested: '재시도 요청',
    complete_requested: '완료 요청', request_approved: '요청 승인',
    request_rejected: '요청 거절',
    button_start_answer: '정답 입력 시작', button_cancel_answer: '정답 입력 취소',
    button_toggle_ready: '준비 토글', button_clear_strokes: '캔버스 초기화',
    button_back_to_review: '리뷰 복귀', question_viewed: '문제 조회',
    active_stroke: '그리기 활동', typing_content: '답안 입력 중',
    player_joined: '플레이어 입장', player_left: '플레이어 퇴장',
    mc_option_toggle: '객관식 선택 변경', image_placed: '이미지 배치',
    image_updated: '이미지 위치/크기 조정', session_timer_tick: '세션 타이머 기록',
}

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

    // User map: player_id → admin_alias (Feature 4)
    const [userMap, setUserMap] = useState<Record<string, string>>({})

    // Time limit state (Feature 1)
    const [groupTimeLimit, setGroupTimeLimit] = useState<number | null>(null)
    const [isTimeLimitOpen, setIsTimeLimitOpen] = useState(false)
    const [timeLimitInput, setTimeLimitInput] = useState("")
    const [isSavingTimeLimit, setIsSavingTimeLimit] = useState(false)

    // Session time limit state
    const [sessionTimeLimit, setSessionTimeLimit] = useState<number | null>(null)
    const [isSessionTimeLimitOpen, setIsSessionTimeLimitOpen] = useState(false)
    const [sessionTimeLimitInput, setSessionTimeLimitInput] = useState("")
    const [isSavingSessionTimeLimit, setIsSavingSessionTimeLimit] = useState(false)

    // Room edit state (Feature 3)
    const [editingRoom, setEditingRoom] = useState<RoomRow | null>(null)
    const [editCode, setEditCode] = useState("")
    const [editP1Alias, setEditP1Alias] = useState("")
    const [editP2Alias, setEditP2Alias] = useState("")
    const [isSavingEdit, setIsSavingEdit] = useState(false)

    // Single room add state
    const [isAddRoomOpen, setIsAddRoomOpen] = useState(false)
    const [addRoomCode, setAddRoomCode] = useState("")
    const [addP1Alias, setAddP1Alias] = useState("")
    const [addP2Alias, setAddP2Alias] = useState("")
    const [isAddingRoom, setIsAddingRoom] = useState(false)

    const fetchGroupData = async () => {
        if (!groupId) return

        logger.info(`Admin fetching rooms for group: ${groupId}`)
        // Fetch group info (including question_ids and time_limit)
        const { data: groupData } = await (supabase as any)
            .from('room_groups')
            .select('name, question_ids, time_limit, session_time_limit')
            .eq('id', groupId)
            .single()

        if (groupData) {
            setGroupName(groupData.name)
            setGroupQuestionIds(groupData.question_ids || [])
            setGroupTimeLimit(groupData.time_limit ?? null)
            setSessionTimeLimit(groupData.session_time_limit ?? null)
        }

        // Fetch rooms
        const { data } = await (supabase as any)
            .from('rooms')
            .select('*')
            .eq('group_id', groupId)
            .order('created_at', { ascending: false })

        if (data) {
            logger.info(`Admin fetched ${data.length} rooms successfully.`)
            const roomsData = data as RoomRow[]
            setRooms(roomsData)

            // Fetch user aliases for all players
            const allUserIds = roomsData.flatMap(r => [r.player1_id, r.player2_id]).filter(Boolean) as string[]
            if (allUserIds.length > 0) {
                const { data: usersData } = await (supabase as any)
                    .from('users')
                    .select('id, admin_alias')
                    .in('id', allUserIds)
                const map: Record<string, string> = {}
                if (usersData) {
                    usersData.forEach((u: any) => { map[u.id] = u.admin_alias })
                }
                setUserMap(map)
            }
        }
    }

    const fetchBankQuestions = async () => {
        const { data } = await (supabase as any).from('questions').select('id, title, question_type, image_url, correct_answer').order('created_at', { ascending: false })
        if (data) setBankQuestions(data)
    }

    const handleSaveQuestions = async () => {
        setIsSavingQuestions(true)
        try {
            // 1. room_groups 업데이트
            await (supabase as any).from('room_groups').update({ question_ids: selectedQuestionIds }).eq('id', groupId)

            // 2. 기존 pending 방들의 room_questions 동기화
            const pendingRooms = rooms.filter(r => r.status === 'pending')
            for (const room of pendingRooms) {
                await (supabase as any).from('room_questions').delete().eq('room_id', room.id)
                if (selectedQuestionIds.length > 0) {
                    const newRQs = selectedQuestionIds.map(qId => ({
                        room_id: room.id,
                        question_id: qId
                    }))
                    await (supabase as any).from('room_questions').insert(newRQs)
                }
            }

            setGroupQuestionIds(selectedQuestionIds)
            setIsSelectModalOpen(false)
            const syncedCount = pendingRooms.length
            alert(`출제 문제가 저장되었습니다.${syncedCount > 0 ? ` 대기중인 ${syncedCount}개 방에 반영 완료.` : ''}`)
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

    const moveQuestion = (fromIdx: number, direction: 'up' | 'down') => {
        const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1
        if (toIdx < 0 || toIdx >= selectedQuestionIds.length) return
        const next = [...selectedQuestionIds]
            ;[next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]]
        setSelectedQuestionIds(next)
    }

    const removeQuestion = (id: string) => {
        setSelectedQuestionIds(prev => prev.filter(q => q !== id))
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
                    const p1Code = generateInviteCode()
                    const p2Code = generateInviteCode()

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

    // Feature 1: Save time limit
    const handleSaveTimeLimit = async () => {
        setIsSavingTimeLimit(true)
        try {
            const value = timeLimitInput.trim() === '' ? null : parseInt(timeLimitInput, 10)
            if (value !== null && (isNaN(value) || value < 10 || value > 600)) {
                alert("시간은 10~600초 사이로 입력하거나, 비워두면 문제별 설정을 사용합니다.")
                return
            }
            await (supabase as any).from('room_groups').update({ time_limit: value }).eq('id', groupId)
            setGroupTimeLimit(value)
            setIsTimeLimitOpen(false)
        } catch (err) {
            console.error(err)
            alert("저장 중 오류가 발생했습니다.")
        } finally {
            setIsSavingTimeLimit(false)
        }
    }

    // Save session time limit
    const handleSaveSessionTimeLimit = async () => {
        setIsSavingSessionTimeLimit(true)
        try {
            const value = sessionTimeLimitInput.trim() === '' ? null : parseInt(sessionTimeLimitInput, 10)
            if (value !== null && (isNaN(value) || value < 0)) {
                alert("0 이상의 숫자를 입력하세요. 0 또는 비우면 제한 없음.")
                return
            }
            const dbValue = (value === 0) ? null : value
            await (supabase as any).from('room_groups').update({ session_time_limit: dbValue }).eq('id', groupId)
            setSessionTimeLimit(dbValue)
            setIsSessionTimeLimitOpen(false)
        } catch (err) {
            console.error(err)
            alert("저장 중 오류가 발생했습니다.")
        } finally {
            setIsSavingSessionTimeLimit(false)
        }
    }

    // Feature 3: Save room edit
    const handleSaveEdit = async () => {
        if (!editingRoom) return
        setIsSavingEdit(true)
        try {
            // Update room code
            await (supabase as any).from('rooms').update({ code: editCode.trim() }).eq('id', editingRoom.id)

            // Update player aliases
            if (editingRoom.player1_id) {
                await (supabase as any).from('users').update({ admin_alias: editP1Alias.trim() }).eq('id', editingRoom.player1_id)
            }
            if (editingRoom.player2_id) {
                await (supabase as any).from('users').update({ admin_alias: editP2Alias.trim() }).eq('id', editingRoom.player2_id)
            }

            // Update local state immediately
            setRooms(prev => prev.map(r => r.id === editingRoom.id ? { ...r, code: editCode.trim() } : r))
            setUserMap(prev => {
                const next = { ...prev }
                if (editingRoom.player1_id) next[editingRoom.player1_id] = editP1Alias.trim()
                if (editingRoom.player2_id) next[editingRoom.player2_id] = editP2Alias.trim()
                return next
            })
            setEditingRoom(null)
        } catch (err) {
            console.error(err)
            alert("저장 중 오류가 발생했습니다.")
        } finally {
            setIsSavingEdit(false)
        }
    }

    // Add single room
    const handleAddSingleRoom = async () => {
        if (!groupId) return
        setIsAddingRoom(true)
        try {
            const p1Id = crypto.randomUUID()
            const p2Id = crypto.randomUUID()
            const p1Code = generateInviteCode()
            const p2Code = generateInviteCode()

            const { error: userError } = await (supabase as any).from('users').insert([
                { id: p1Id, admin_alias: addP1Alias.trim() || '익명1' },
                { id: p2Id, admin_alias: addP2Alias.trim() || '익명2' }
            ])
            if (userError) throw userError

            const { data: roomData, error: roomError } = await (supabase as any).from('rooms').insert({
                group_id: groupId,
                code: addRoomCode.trim() || `방-${rooms.length + 1}`,
                player1_id: p1Id,
                player2_id: p2Id,
                player1_invite_code: p1Code,
                player2_invite_code: p2Code,
                status: 'pending'
            }).select().single()
            if (roomError || !roomData) throw roomError

            if (groupQuestionIds.length > 0) {
                const roomQuestions = groupQuestionIds.map((qId: string) => ({
                    room_id: roomData.id,
                    question_id: qId
                }))
                await (supabase as any).from('room_questions').insert(roomQuestions)
            }

            setIsAddRoomOpen(false)
            setAddRoomCode("")
            setAddP1Alias("")
            setAddP2Alias("")
            fetchGroupData()
        } catch (err) {
            console.error(err)
            alert("방 추가 중 오류가 발생했습니다.")
        } finally {
            setIsAddingRoom(false)
        }
    }

    // Feature 5: Download access codes
    const handleDownloadCodes = () => {
        if (rooms.length === 0) {
            alert("다운로드할 방이 없습니다.")
            return
        }
        const excelRows = rooms.map(room => ({
            '방 식별자': room.code || '-',
            'P1 이름': userMap[room.player1_id || ''] || '-',
            'P1 접속코드': room.player1_invite_code || '-',
            'P2 이름': userMap[room.player2_id || ''] || '-',
            'P2 접속코드': room.player2_invite_code || '-',
        }))
        const ws = XLSX.utils.json_to_sheet(excelRows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, '접속코드')
        const fileName = `${groupName}_접속코드_${new Date().toISOString().slice(0, 10)}.xlsx`
        XLSX.writeFile(wb, fileName)
    }

    const handleDownloadResults = async () => {
        if (rooms.length === 0) {
            alert("다운로드할 세션이 없습니다.")
            return
        }

        logger.info("Downloading results for group:", groupId)

        try {
            // 1. Fetch all room_questions for rooms in this group
            const roomIds = rooms.map(r => r.id)
            const { data: rqData, error: rqError } = await (supabase as any)
                .from('room_questions')
                .select('*, questions(title, correct_answer, question_type)')
                .in('room_id', roomIds)

            if (rqError) throw rqError

            // 2. Fetch user aliases
            const allUserIds = rooms.flatMap(r => [r.player1_id, r.player2_id]).filter(Boolean)
            const { data: usersData } = await (supabase as any)
                .from('users')
                .select('id, admin_alias')
                .in('id', allUserIds)

            const userMap: Record<string, string> = {}
            if (usersData) {
                usersData.forEach((u: any) => { userMap[u.id] = u.admin_alias })
            }

            // 3. Build rows for Excel
            const excelRows: any[] = []

            for (const room of rooms) {
                const roomRQs = (rqData || []).filter((rq: any) => rq.room_id === room.id)
                const p1Alias = userMap[room.player1_id || ''] || 'P1 미확인'
                const p2Alias = userMap[room.player2_id || ''] || 'P2 미확인'

                for (const rq of roomRQs) {
                    excelRows.push({
                        '그룹명': groupName,
                        '방 식별자': room.code || '-',
                        '방 상태': room.status === 'completed' ? '완료' : room.status === 'playing' ? '진행중' : '대기중',
                        'Player1 (P1)': p1Alias,
                        'Player2 (P2)': p2Alias,
                        '문제 제목': rq.questions?.title || '제목 없음',
                        '문제 유형': rq.questions?.question_type === 'essay' ? '주관식' : '객관식',
                        '정답': rq.questions?.correct_answer || '-',
                        '제출 답안': rq.submitted_answer || '(미제출)',
                        '자동 채점': rq.is_correct === true ? 'O 정답' : rq.is_correct === false ? 'X 오답' : '-',
                    })
                }

                // If no questions linked, still include a row per room
                if (roomRQs.length === 0) {
                    excelRows.push({
                        '그룹명': groupName,
                        '방 식별자': room.code || '-',
                        '방 상태': room.status === 'completed' ? '완료' : room.status === 'playing' ? '진행중' : '대기중',
                        'Player1 (P1)': p1Alias,
                        'Player2 (P2)': p2Alias,
                        '문제 제목': '(문제 없음)',
                        '문제 유형': '-',
                        '정답': '-',
                        '제출 답안': '-',
                        '자동 채점': '-',
                    })
                }
            }

            // 4. Export with XLSX — Sheet1: 결과
            const ws = XLSX.utils.json_to_sheet(excelRows)
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, '결과')

            // 5. Sheet2: 게임 로그 (turns_log)
            try {
                const { data: logsData } = await (supabase as any)
                    .from('turns_log')
                    .select('*')
                    .in('room_id', roomIds)
                    .order('created_at', { ascending: true })

                if (logsData && logsData.length > 0) {
                    const logRows = logsData.map((log: any) => {
                        const room = rooms.find(r => r.id === log.room_id)
                        return {
                            '방 식별자': room?.code || '-',
                            '플레이어': userMap[log.player_id] || log.player_id || '-',
                            '이벤트 유형': log.event_type,
                            '이벤트 이름': EVENT_TYPE_LABELS[log.event_type] || log.event_type,
                            '메타데이터(JSON)': JSON.stringify(log.metadata),
                            '발생 시각': log.created_at,
                        }
                    })
                    const ws2 = XLSX.utils.json_to_sheet(logRows)
                    XLSX.utils.book_append_sheet(wb, ws2, '게임 로그')
                }
            } catch (logErr) {
                logger.error("turns_log 조회 실패 (Sheet2 생략):", logErr)
            }

            const fileName = `${groupName}_결과_${new Date().toISOString().slice(0, 10)}.xlsx`
            XLSX.writeFile(wb, fileName)
            logger.info(`Downloaded results: ${fileName}`)
        } catch (err: any) {
            logger.error("Result download failed:", err)
            alert("다운로드 중 오류가 발생했습니다: " + err.message)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <Link to=".." className="p-2 hover:bg-muted rounded-md transition-colors">
                    <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                </Link>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{groupName}</h2>
                    <p className="text-muted-foreground">이 그룹의 모든 턴제 드로잉 세션을 한눈에 봅니다.</p>
                </div>
            </div>

            <div className="flex justify-between items-center bg-card p-4 rounded-lg border">
                <div className="flex gap-6">
                    <div className="text-sm">
                        <p className="text-muted-foreground mb-1">총 세션</p>
                        <p className="text-2xl font-bold">{rooms.length}</p>
                    </div>
                    <div className="text-sm border-l pl-6">
                        <p className="text-muted-foreground mb-1">대기중</p>
                        <p className="text-2xl font-bold text-muted-foreground">{rooms.filter(r => r.status === 'pending').length}</p>
                    </div>
                    <div className="text-sm border-l pl-6">
                        <p className="text-muted-foreground mb-1">진행중</p>
                        <p className="text-2xl font-bold text-primary">{rooms.filter(r => r.status === 'playing').length}</p>
                    </div>
                    <div className="text-sm border-l pl-6">
                        <p className="text-muted-foreground mb-1">완료</p>
                        <p className="text-2xl font-bold text-green-600">{rooms.filter(r => r.status === 'completed').length}</p>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    {/* Row 1: Settings + Add */}
                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" className="gap-2" onClick={() => {
                            setTimeLimitInput(groupTimeLimit !== null ? String(groupTimeLimit) : '')
                            setIsTimeLimitOpen(true)
                        }}>
                            <Clock className="w-4 h-4" />
                            {groupTimeLimit !== null ? `턴 시간: ${groupTimeLimit}초` : '턴 시간'}
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={() => {
                            setSessionTimeLimitInput(sessionTimeLimit !== null ? String(sessionTimeLimit) : '')
                            setIsSessionTimeLimitOpen(true)
                        }}>
                            <Clock className="w-4 h-4" />
                            {sessionTimeLimit !== null ? `세션 시간: ${sessionTimeLimit}분` : '세션 시간'}
                        </Button>
                        <Button
                            variant="outline"
                            className="gap-2"
                            onClick={() => setIsAddRoomOpen(true)}
                        >
                            <PlusCircle className="w-4 h-4" />
                            방 추가
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
                            방 추가(템플릿)
                        </Button>
                    </div>
                    {/* Row 2: Downloads */}
                    <div className="flex gap-2 justify-end">
                        <Button
                            onClick={() => {
                                setSelectedQuestionIds(groupQuestionIds)
                                setIsSelectModalOpen(true)
                                fetchBankQuestions()
                            }}
                            variant="outline"
                            className="gap-2"
                        >
                            <Settings className="w-4 h-4" />
                            출제 문항 ({groupQuestionIds.length}개)
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleDownloadCodes}>
                            <Download className="w-4 h-4" />
                            접속코드
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleDownloadResults}>
                            <Download className="w-4 h-4" />
                            결과 엑셀
                        </Button>
                    </div>
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
                            <TableHead className="text-right">액션</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rooms.map((room) => (
                            <TableRow key={room.id}>
                                <TableCell className="font-medium">{room.code || '-'}</TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-xs text-muted-foreground">{userMap[room.player1_id || ''] || '-'}</span>
                                        <span className="font-mono text-lg text-primary">{room.player1_invite_code}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-xs text-muted-foreground">{userMap[room.player2_id || ''] || '-'}</span>
                                        <span className="font-mono text-lg text-blue-600">{room.player2_invite_code}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {room.status === "completed" && <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">완료</Badge>}
                                    {room.status === "playing" && <Badge className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">진행중</Badge>}
                                    {room.status === "pending" && <Badge variant="outline" className="text-muted-foreground">대기중</Badge>}
                                </TableCell>
                                <TableCell>
                                    {(room.current_question_index ?? 0) + 1} / {groupQuestionIds.length > 0 ? groupQuestionIds.length : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Link to={`../recap/${room.id}`}>
                                            <Button variant="ghost" size="sm">
                                                리캡 보기
                                            </Button>
                                        </Link>
                                        <Button variant="ghost" size="sm" onClick={() => {
                                            setEditingRoom(room)
                                            setEditCode(room.code || '')
                                            setEditP1Alias(userMap[room.player1_id || ''] || '')
                                            setEditP2Alias(userMap[room.player2_id || ''] || '')
                                        }}>
                                            <Pencil className="w-4 h-4" />
                                        </Button>
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

            {/* Time Limit Dialog (Feature 1) */}
            <Dialog open={isTimeLimitOpen} onOpenChange={setIsTimeLimitOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>턴 시간 설정</DialogTitle>
                        <DialogDescription>
                            방에서 진행하는 모든 문제에 적용할 턴 시간(초)을 설정합니다. 비워두면 문제별 기본 시간이 사용됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="timeLimit">턴 시간 (초)</Label>
                            <Input
                                id="timeLimit"
                                type="number"
                                min={10}
                                max={600}
                                placeholder="비우면 문제별 설정 사용"
                                value={timeLimitInput}
                                onChange={e => setTimeLimitInput(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">10~600초, 비우면 문제별 설정된 시간 사용</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTimeLimitOpen(false)}>취소</Button>
                        <Button onClick={handleSaveTimeLimit} disabled={isSavingTimeLimit}>
                            {isSavingTimeLimit && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Session Time Limit Dialog */}
            <Dialog open={isSessionTimeLimitOpen} onOpenChange={setIsSessionTimeLimitOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>세션 전체 시간 설정</DialogTitle>
                        <DialogDescription>
                            방의 제한 시간(분)을 설정합니다. 0이거나 비워두면 제한 없음.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="sessionTimeLimit">세션 시간 (분)</Label>
                            <Input
                                id="sessionTimeLimit"
                                type="number"
                                min={0}
                                placeholder="비우면 제한 없음"
                                value={sessionTimeLimitInput}
                                onChange={e => setSessionTimeLimitInput(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">0 또는 비우면 제한 없음. 예: 30 = 30분</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSessionTimeLimitOpen(false)}>취소</Button>
                        <Button onClick={handleSaveSessionTimeLimit} disabled={isSavingSessionTimeLimit}>
                            {isSavingSessionTimeLimit && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Room Edit Dialog (Feature 3) */}
            <Dialog open={!!editingRoom} onOpenChange={(open) => { if (!open) setEditingRoom(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>방 정보 수정</DialogTitle>
                        <DialogDescription>방 식별자와 참여자 이름을 수정합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="editCode">방 식별자 (조 이름)</Label>
                            <Input id="editCode" value={editCode} onChange={e => setEditCode(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="editP1">Player 1 이름</Label>
                            <Input id="editP1" value={editP1Alias} onChange={e => setEditP1Alias(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="editP2">Player 2 이름</Label>
                            <Input id="editP2" value={editP2Alias} onChange={e => setEditP2Alias(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingRoom(null)}>취소</Button>
                        <Button onClick={handleSaveEdit} disabled={isSavingEdit}>
                            {isSavingEdit && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                            <Link to="../questions">
                                <Button variant="outline" size="sm" className="gap-2">
                                    <PlusCircle className="w-4 h-4" />
                                    문제 은행에 문제 만들러 가기
                                </Button>
                            </Link>
                        )}
                    </div>

                    {/* Selected Question Order List */}
                    {selectedQuestionIds.length > 0 && (
                        <div className="border rounded-lg p-3 mb-2 bg-muted/30">
                            <p className="text-xs font-semibold text-muted-foreground mb-2">출제 순서</p>
                            <div className="space-y-1">
                                {selectedQuestionIds.map((qId, idx) => {
                                    const q = bankQuestions.find((b: any) => b.id === qId)
                                    return (
                                        <div key={qId} className="flex items-center gap-2 bg-card rounded-md px-3 py-1.5 border text-sm">
                                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                                                {idx + 1}
                                            </span>
                                            <span className="flex-1 truncate">{q?.title || q?.correct_answer || qId}</span>
                                            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => moveQuestion(idx, 'up')} disabled={idx === 0}>
                                                <ArrowUp className="w-3 h-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => moveQuestion(idx, 'down')} disabled={idx === selectedQuestionIds.length - 1}>
                                                <ArrowDown className="w-3 h-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="w-6 h-6 text-destructive hover:bg-destructive/10" onClick={() => removeQuestion(qId)}>
                                                <X className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 py-4">
                        {bankQuestions.length === 0 && (
                            <div className="col-span-full py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg">
                                등록된 문제가 없습니다. 좌측 "문제 은행" 메뉴에서 먼저 이미지를 등록해주세요.
                            </div>
                        )}
                        {bankQuestions.map((q) => {
                            const isSelected = selectedQuestionIds.includes(q.id)
                            const orderNum = isSelected ? selectedQuestionIds.indexOf(q.id) + 1 : 0
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
                                            {isSelected ? <span className="text-xs font-bold">{orderNum}</span> : null}
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
                            선택 문제 확정
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add Single Room Dialog */}
            <Dialog open={isAddRoomOpen} onOpenChange={setIsAddRoomOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>방 1개 추가</DialogTitle>
                        <DialogDescription>새로운 방을 수동으로 추가합니다. 접속코드는 자동 생성됩니다.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="addRoomCode">방 식별자 (조 이름)</Label>
                            <Input id="addRoomCode" placeholder={`방-${rooms.length + 1}`} value={addRoomCode} onChange={e => setAddRoomCode(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="addP1">Player 1 이름</Label>
                            <Input id="addP1" placeholder="익명1" value={addP1Alias} onChange={e => setAddP1Alias(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="addP2">Player 2 이름</Label>
                            <Input id="addP2" placeholder="익명2" value={addP2Alias} onChange={e => setAddP2Alias(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddRoomOpen(false)}>취소</Button>
                        <Button onClick={handleAddSingleRoom} disabled={isAddingRoom}>
                            {isAddingRoom && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            추가
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

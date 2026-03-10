import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Download, ExternalLink, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"
import type { Database } from "@turn-based-drawing/supabase"

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"]
type RecordingFileRow = Database["public"]["Tables"]["recording_files"]["Row"]

const FILE_TYPE_LABELS: Record<string, string> = {
    p1_face: "P1 얼굴",
    p2_face: "P2 얼굴",
    p1_screen: "P1 화면",
    p2_screen: "P2 화면",
    composite: "통합 영상",
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    recording: { label: "녹화중", color: "text-red-500" },
    processing: { label: "처리중", color: "text-yellow-500" },
    uploaded: { label: "업로드 완료", color: "text-green-500" },
    failed: { label: "실패", color: "text-gray-500" },
}

function formatFileSize(bytes: number | null): string {
    if (!bytes) return "-"
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

function formatDuration(seconds: number | null): string {
    if (!seconds) return "-"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}분 ${s.toString().padStart(2, "0")}초`
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-"
    const d = new Date(dateStr)
    return d.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    })
}

export default function AdminRecordingViewer() {
    const { roomId } = useParams<{ roomId: string }>()

    const [room, setRoom] = useState<RoomRow | null>(null)
    const [recordingFiles, setRecordingFiles] = useState<RecordingFileRow[]>([])
    const [playerNames, setPlayerNames] = useState<Record<string, string>>({})
    const [roomQuestions, setRoomQuestions] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedFileType, setSelectedFileType] = useState<string>("composite")

    const videoRef = useRef<HTMLVideoElement>(null)

    // Fetch all data on mount
    useEffect(() => {
        if (!roomId) return

        const fetchData = async () => {
            setLoading(true)

            // Fetch room
            const { data: roomData } = await (supabase as any)
                .from("rooms")
                .select("*")
                .eq("id", roomId)
                .single()

            if (roomData) setRoom(roomData as RoomRow)

            // Fetch recording files
            const { data: filesData } = await (supabase as any)
                .from("recording_files")
                .select("*")
                .eq("room_id", roomId)
                .order("created_at", { ascending: true })

            if (filesData) setRecordingFiles(filesData as RecordingFileRow[])

            // Fetch room_questions with question data
            const { data: rqData } = await (supabase as any)
                .from("room_questions")
                .select("*, questions(*)")
                .eq("room_id", roomId)
                .order("created_at", { ascending: true })

            if (rqData) setRoomQuestions(rqData)

            // Fetch player names
            if (roomData) {
                const playerIds = [roomData.player1_id, roomData.player2_id].filter(Boolean)
                if (playerIds.length > 0) {
                    const { data: usersData } = await (supabase as any)
                        .from("users")
                        .select("id, admin_alias")
                        .in("id", playerIds)

                    if (usersData) {
                        const names: Record<string, string> = {}
                        for (const u of usersData) {
                            names[u.id] = u.admin_alias || u.id.slice(0, 8)
                        }
                        setPlayerNames(names)
                    }
                }
            }

            setLoading(false)
        }

        fetchData()
    }, [roomId])

    // Derived values
    const selectedFile = recordingFiles.find((f) => f.file_type === selectedFileType)
    const compositeFile = recordingFiles.find((f) => f.file_type === "composite")

    const p1Name = room?.player1_id ? (playerNames[room.player1_id] || "P1") : "P1"
    const p2Name = room?.player2_id ? (playerNames[room.player2_id] || "P2") : "P2"

    const totalQuestions = roomQuestions.length
    const correctCount = roomQuestions.filter((rq: any) => rq.is_correct === true).length

    const sessionDuration = compositeFile?.duration
        ?? recordingFiles.find((f) => f.duration)?.duration
        ?? null

    const videoSrc = selectedFile?.gdrive_url || null

    // When selected file changes, update video source
    useEffect(() => {
        if (videoRef.current && videoSrc) {
            videoRef.current.load()
        }
    }, [videoSrc])

    // Download metadata as JSON
    const downloadMetadata = () => {
        const metadata = {
            room: {
                id: room?.id,
                code: room?.code,
                status: room?.status,
                created_at: room?.created_at,
            },
            players: {
                p1: { id: room?.player1_id, name: p1Name },
                p2: { id: room?.player2_id, name: p2Name },
            },
            recording_files: recordingFiles.map((f) => ({
                id: f.id,
                file_type: f.file_type,
                status: f.status,
                file_size: f.file_size,
                duration: f.duration,
                gdrive_url: f.gdrive_url,
                file_path: f.file_path,
            })),
            questions: roomQuestions.map((rq: any) => ({
                question: rq.questions?.content,
                submitted_answer: rq.submitted_answer,
                is_correct: rq.is_correct,
            })),
            session_duration: sessionDuration,
        }

        const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `recording-${room?.code || roomId}-metadata.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center space-y-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                    <p className="text-sm text-muted-foreground">녹화 데이터를 불러오는 중...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Header */}
            <header className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-card">
                <div className="flex items-center gap-3">
                    <Link to="../.." className="p-2 hover:bg-muted rounded-md transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <span className="font-bold text-lg">
                        Room {room?.code || roomId?.slice(0, 6)} 녹화 영상
                    </span>
                    <Badge variant="secondary">
                        {room?.status === "completed" ? "완료" : room?.status || "-"}
                    </Badge>
                </div>
                <span className="text-sm text-muted-foreground">
                    {formatDate(room?.created_at ?? null)}
                </span>
            </header>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="max-w-5xl mx-auto space-y-6">

                    {/* Main Video Player */}
                    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h2 className="font-semibold">
                                {FILE_TYPE_LABELS[selectedFileType] || selectedFileType}
                            </h2>
                            {selectedFile && (
                                <Badge
                                    variant="outline"
                                    className={STATUS_LABELS[selectedFile.status]?.color || ""}
                                >
                                    {STATUS_LABELS[selectedFile.status]?.label || selectedFile.status}
                                </Badge>
                            )}
                        </div>

                        <div className="aspect-video bg-black flex items-center justify-center">
                            {videoSrc ? (
                                <video
                                    ref={videoRef}
                                    controls
                                    playsInline
                                    className="w-full h-full"
                                >
                                    <source src={videoSrc} type="video/mp4" />
                                </video>
                            ) : (
                                <div className="text-center text-white/60 space-y-2">
                                    <Play className="w-12 h-12 mx-auto opacity-40" />
                                    <p className="text-sm">
                                        {selectedFile
                                            ? "영상 처리 중..."
                                            : "녹화 파일이 없습니다"}
                                    </p>
                                    {selectedFile && (
                                        <p className="text-xs opacity-60">
                                            상태: {STATUS_LABELS[selectedFile.status]?.label || selectedFile.status}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Individual Track Thumbnails */}
                    <div>
                        <h3 className="text-sm font-semibold text-muted-foreground mb-3">개별 영상:</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {(["p1_face", "p2_face", "p1_screen", "p2_screen"] as const).map((fileType) => {
                                const file = recordingFiles.find((f) => f.file_type === fileType)
                                const isSelected = selectedFileType === fileType
                                const statusInfo = file ? STATUS_LABELS[file.status] : null

                                return (
                                    <button
                                        key={fileType}
                                        onClick={() => setSelectedFileType(fileType)}
                                        className={`
                                            border rounded-lg p-3 text-left transition-all
                                            hover:border-primary/50 hover:shadow-sm
                                            ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-card"}
                                        `}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium">
                                                {FILE_TYPE_LABELS[fileType]}
                                            </span>
                                            {file && (
                                                <Play className="w-3.5 h-3.5 text-muted-foreground" />
                                            )}
                                        </div>
                                        {file ? (
                                            <div className="space-y-1">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs ${statusInfo?.color || ""}`}
                                                >
                                                    {statusInfo?.label || file.status}
                                                </Badge>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatFileSize(file.file_size)}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">파일 없음</p>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Composite track selector */}
                    {compositeFile && selectedFileType !== "composite" && (
                        <button
                            onClick={() => setSelectedFileType("composite")}
                            className="w-full border rounded-lg p-3 bg-card hover:border-primary/50 hover:shadow-sm transition-all text-left flex items-center justify-between"
                        >
                            <div className="flex items-center gap-2">
                                <Play className="w-4 h-4 text-muted-foreground" />
                                <span className="text-sm font-medium">통합 영상 (composite)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge
                                    variant="outline"
                                    className={`text-xs ${STATUS_LABELS[compositeFile.status]?.color || ""}`}
                                >
                                    {STATUS_LABELS[compositeFile.status]?.label || compositeFile.status}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                    {formatFileSize(compositeFile.file_size)}
                                </span>
                            </div>
                        </button>
                    )}

                    {/* Download Buttons */}
                    <div className="flex flex-wrap gap-3">
                        {recordingFiles.some((f) => f.gdrive_url) && (
                            <div className="flex flex-wrap gap-2">
                                {recordingFiles
                                    .filter((f) => f.gdrive_url)
                                    .map((f) => (
                                        <a
                                            key={f.id}
                                            href={f.gdrive_url!}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <Button variant="outline" size="sm">
                                                <Download className="w-4 h-4 mr-1" />
                                                {FILE_TYPE_LABELS[f.file_type] || f.file_type}
                                            </Button>
                                        </a>
                                    ))}
                            </div>
                        )}
                        <Button variant="outline" size="sm" onClick={downloadMetadata}>
                            <Download className="w-4 h-4 mr-1" />
                            메타데이터 (JSON)
                        </Button>
                    </div>

                    {/* Session Info */}
                    <div className="bg-card border rounded-lg p-5 space-y-3">
                        <h3 className="font-semibold text-sm">세션 정보</h3>
                        <div className="space-y-2 text-sm">
                            <div className="flex items-start gap-2">
                                <span className="text-muted-foreground shrink-0">참가자:</span>
                                <span>{p1Name} (P1), {p2Name} (P2)</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-muted-foreground shrink-0">문제:</span>
                                <span>
                                    {totalQuestions}개
                                    {totalQuestions > 0 && (
                                        <span className="text-muted-foreground ml-1">
                                            (정답: {correctCount}/{totalQuestions})
                                        </span>
                                    )}
                                </span>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-muted-foreground shrink-0">소요시간:</span>
                                <span>{formatDuration(sessionDuration)}</span>
                            </div>
                            {recordingFiles.some((f) => f.gdrive_url) && (
                                <div className="flex items-start gap-2">
                                    <span className="text-muted-foreground shrink-0">Google Drive:</span>
                                    <div className="flex flex-wrap gap-2">
                                        {recordingFiles
                                            .filter((f) => f.gdrive_url)
                                            .map((f) => (
                                                <a
                                                    key={f.id}
                                                    href={f.gdrive_url!}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-primary hover:underline"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                    {FILE_TYPE_LABELS[f.file_type] || f.file_type}
                                                </a>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}

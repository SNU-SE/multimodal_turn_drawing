import { useEffect, useState, useRef, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Volume2, VolumeX, Circle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { VideoTile } from "@/components/media/VideoTile"
import { supabase } from "@/lib/supabase"
import { fetchLivekitToken, LIVEKIT_URL } from "@/lib/livekit"
import {
    Room,
    RoomEvent,
    Track,
    RemoteVideoTrack,
    RemoteAudioTrack,
    RemoteTrack,
    RemoteTrackPublication,
    RemoteParticipant,
} from "livekit-client"
import type { Database } from "@turn-based-drawing/supabase"

type RoomRow = Database["public"]["Tables"]["rooms"]["Row"]

interface RemotePlayerTracks {
    identity: string
    camera: RemoteVideoTrack | null
    audio: RemoteAudioTrack | null
}

export default function AdminObserve() {
    const { roomId } = useParams<{ roomId: string }>()

    // LiveKit room
    const livekitRoomRef = useRef<Room | null>(null)
    const [isConnected, setIsConnected] = useState(false)
    const [isConnecting, setIsConnecting] = useState(false)
    const [connectionError, setConnectionError] = useState<string | null>(null)

    // Remote participant tracks (P1 and P2)
    const [p1Tracks, setP1Tracks] = useState<RemotePlayerTracks>({ identity: "", camera: null, audio: null })
    const [p2Tracks, setP2Tracks] = useState<RemotePlayerTracks>({ identity: "", camera: null, audio: null })

    // Audio mute controls (local mute for admin listening)
    const [p1Muted, setP1Muted] = useState(false)
    const [p2Muted, setP2Muted] = useState(false)

    // Supabase room data
    const [room, setRoom] = useState<RoomRow | null>(null)
    const [questions, setQuestions] = useState<any[]>([])
    const [roomQuestions, setRoomQuestions] = useState<any[]>([])

    // Session timer
    const [elapsed, setElapsed] = useState(0)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Real-time canvas strokes (simplified SVG renderer)
    const [strokes, setStrokes] = useState<any[]>([])

    // ── Fetch room data from Supabase ──
    useEffect(() => {
        if (!roomId) return

        const fetchRoomData = async () => {
            // Fetch room
            const { data: roomData } = await (supabase as any)
                .from("rooms")
                .select("*")
                .eq("id", roomId)
                .single()

            if (roomData) setRoom(roomData as RoomRow)

            // Fetch room_questions with joined question data
            const { data: rqData } = await (supabase as any)
                .from("room_questions")
                .select("*, questions(*)")
                .eq("room_id", roomId)
                .order("created_at", { ascending: true })

            if (rqData) {
                setRoomQuestions(rqData)
                setQuestions(rqData.map((rq: any) => rq.questions).filter(Boolean))
            }
        }

        fetchRoomData()
    }, [roomId])

    // ── Poll room data for updates ──
    useEffect(() => {
        if (!roomId) return

        const interval = setInterval(async () => {
            const { data: roomData } = await (supabase as any)
                .from("rooms")
                .select("*")
                .eq("id", roomId)
                .single()

            if (roomData) setRoom(roomData as RoomRow)

            const { data: rqData } = await (supabase as any)
                .from("room_questions")
                .select("*, questions(*)")
                .eq("room_id", roomId)
                .order("created_at", { ascending: true })

            if (rqData) {
                setRoomQuestions(rqData)
                setQuestions(rqData.map((rq: any) => rq.questions).filter(Boolean))
            }
        }, 3000)

        return () => clearInterval(interval)
    }, [roomId])

    // ── Session elapsed timer ──
    useEffect(() => {
        if (room?.status === "playing") {
            const turnState = room.turn_state as any
            const sessionStart = turnState?.sessionStartedAt
                ? new Date(turnState.sessionStartedAt).getTime()
                : Date.now()

            const updateElapsed = () => {
                setElapsed(Math.floor((Date.now() - sessionStart) / 1000))
            }
            updateElapsed()
            timerRef.current = setInterval(updateElapsed, 1000)
        } else {
            setElapsed(0)
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [room?.status, (room?.turn_state as any)?.sessionStartedAt])

    // ── Helper to assign tracks to P1 or P2 ──
    const assignTrack = useCallback(
        (participant: RemoteParticipant, track: RemoteTrack, kind: "camera" | "audio") => {
            const identity = participant.identity
            // First remote participant becomes P1, second becomes P2
            setP1Tracks((prev) => {
                if (prev.identity === identity || prev.identity === "") {
                    return {
                        identity,
                        camera: kind === "camera" ? (track as RemoteVideoTrack) : prev.camera,
                        audio: kind === "audio" ? (track as RemoteAudioTrack) : prev.audio,
                    }
                }
                return prev
            })
            setP2Tracks((prev) => {
                // If p1 already has this identity, this goes to p2
                // We need to check p1 first to decide
                if (prev.identity === identity) {
                    return {
                        identity,
                        camera: kind === "camera" ? (track as RemoteVideoTrack) : prev.camera,
                        audio: kind === "audio" ? (track as RemoteAudioTrack) : prev.audio,
                    }
                }
                return prev
            })

            // Handle the case where P1 slot is taken and this is a new participant for P2
            setP1Tracks((p1) => {
                if (p1.identity !== "" && p1.identity !== identity) {
                    setP2Tracks((p2) => {
                        if (p2.identity === "" || p2.identity === identity) {
                            return {
                                identity,
                                camera: kind === "camera" ? (track as RemoteVideoTrack) : p2.camera,
                                audio: kind === "audio" ? (track as RemoteAudioTrack) : p2.audio,
                            }
                        }
                        return p2
                    })
                }
                return p1
            })
        },
        [],
    )

    // ── Helper to remove tracks when unsubscribed ──
    const removeTrack = useCallback(
        (participant: RemoteParticipant, _track: RemoteTrack, kind: "camera" | "audio") => {
            const identity = participant.identity
            setP1Tracks((prev) => {
                if (prev.identity === identity) {
                    return {
                        ...prev,
                        camera: kind === "camera" ? null : prev.camera,
                        audio: kind === "audio" ? null : prev.audio,
                    }
                }
                return prev
            })
            setP2Tracks((prev) => {
                if (prev.identity === identity) {
                    return {
                        ...prev,
                        camera: kind === "camera" ? null : prev.camera,
                        audio: kind === "audio" ? null : prev.audio,
                    }
                }
                return prev
            })
        },
        [],
    )

    // ── Connect to LiveKit as admin (subscriber-only) ──
    useEffect(() => {
        if (!roomId || isConnected || isConnecting) return

        const connect = async () => {
            setIsConnecting(true)
            setConnectionError(null)

            try {
                const token = await fetchLivekitToken(roomId, "admin", "admin")
                const lkRoom = new Room()

                lkRoom.on(
                    RoomEvent.TrackSubscribed,
                    (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                        if (track.kind === Track.Kind.Video && track.source === Track.Source.Camera) {
                            assignTrack(participant, track, "camera")
                        } else if (track.kind === Track.Kind.Audio) {
                            assignTrack(participant, track, "audio")
                        }
                    },
                )

                lkRoom.on(
                    RoomEvent.TrackUnsubscribed,
                    (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                        if (track.kind === Track.Kind.Video && track.source === Track.Source.Camera) {
                            removeTrack(participant, track, "camera")
                        } else if (track.kind === Track.Kind.Audio) {
                            removeTrack(participant, track, "audio")
                        }
                    },
                )

                lkRoom.on(RoomEvent.Disconnected, () => {
                    setIsConnected(false)
                    setP1Tracks({ identity: "", camera: null, audio: null })
                    setP2Tracks({ identity: "", camera: null, audio: null })
                })

                await lkRoom.connect(LIVEKIT_URL, token)
                livekitRoomRef.current = lkRoom
                setIsConnected(true)
            } catch (err) {
                const message = err instanceof Error ? err.message : "LiveKit 연결 실패"
                setConnectionError(message)
            } finally {
                setIsConnecting(false)
            }
        }

        connect()

        return () => {
            if (livekitRoomRef.current) {
                livekitRoomRef.current.disconnect()
                livekitRoomRef.current = null
            }
        }
    }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Subscribe to Supabase Realtime for canvas strokes ──
    useEffect(() => {
        if (!roomId) return

        const channel = supabase.channel(`observe:${roomId}`, {
            config: { broadcast: { self: false } },
        })

        channel.on("broadcast", { event: "stroke" }, (msg) => {
            if (msg.payload?.stroke) {
                setStrokes((prev) => [...prev, msg.payload.stroke])
            }
        })
        channel.on("broadcast", { event: "erase" }, (msg) => {
            if (msg.payload?.strokeId) {
                setStrokes((prev) => prev.filter((s: any) => s.id !== msg.payload.strokeId))
            }
        })
        channel.on("broadcast", { event: "clear" }, () => {
            setStrokes([])
        })

        channel.subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [roomId])

    // ── Audio muting (attach/detach audio elements) ──
    const p1AudioRef = useRef<HTMLAudioElement | null>(null)
    const p2AudioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
        if (!p1Tracks.audio) return
        if (!p1AudioRef.current) {
            p1AudioRef.current = document.createElement("audio")
            p1AudioRef.current.autoplay = true
        }
        p1Tracks.audio.attach(p1AudioRef.current)
        p1AudioRef.current.muted = p1Muted

        return () => {
            if (p1AudioRef.current && p1Tracks.audio) {
                p1Tracks.audio.detach(p1AudioRef.current)
            }
        }
    }, [p1Tracks.audio, p1Muted])

    useEffect(() => {
        if (!p2Tracks.audio) return
        if (!p2AudioRef.current) {
            p2AudioRef.current = document.createElement("audio")
            p2AudioRef.current.autoplay = true
        }
        p2Tracks.audio.attach(p2AudioRef.current)
        p2AudioRef.current.muted = p2Muted

        return () => {
            if (p2AudioRef.current && p2Tracks.audio) {
                p2Tracks.audio.detach(p2AudioRef.current)
            }
        }
    }, [p2Tracks.audio, p2Muted])

    // ── Derived state ──
    const turnState = room?.turn_state as any
    const currentQuestionIndex = room?.current_question_index ?? 0
    const currentQuestion = questions[currentQuestionIndex]
    const currentRQ = roomQuestions[currentQuestionIndex]
    const currentTurnPlayerId = turnState?.currentPlayerId
    const isP1Turn = currentTurnPlayerId === room?.player1_id
    const timeLeft = turnState?.timeLeft ?? 0

    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60)
        const s = secs % 60
        return `${m}:${s.toString().padStart(2, "0")}`
    }

    const statusLabel = (status: string | null) => {
        switch (status) {
            case "pending":
                return "대기 중"
            case "playing":
                return "진행 중"
            case "completed":
                return "완료"
            default:
                return status || "-"
        }
    }

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* ── Header ── */}
            <header className="h-14 flex items-center justify-between px-6 border-b shrink-0 bg-card">
                <div className="flex items-center gap-3">
                    <Link to="../.." className="p-2 hover:bg-muted rounded-md transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <span className="font-bold text-lg">
                        Room {room?.code || roomId?.slice(0, 6)} 관찰 중
                    </span>
                    <Badge variant={room?.status === "playing" ? "default" : "secondary"}>
                        {statusLabel(room?.status ?? null)}
                    </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {room?.status === "playing" && (
                        <>
                            <span className="flex items-center gap-1">
                                <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
                                라이브
                            </span>
                            <span className="font-mono tabular-nums">{formatTime(elapsed)}</span>
                        </>
                    )}
                    {isConnected && (
                        <Badge variant="secondary" className="text-green-600 border-green-300">
                            LiveKit 연결됨
                        </Badge>
                    )}
                    {isConnecting && (
                        <Badge variant="secondary">연결 중...</Badge>
                    )}
                    {connectionError && (
                        <Badge variant="destructive">{connectionError}</Badge>
                    )}
                </div>
            </header>

            {/* ── Main Content ── */}
            <main className="flex-1 flex overflow-hidden">
                {/* Left Panel: Players + Info */}
                <div className="w-[400px] shrink-0 border-r flex flex-col overflow-y-auto p-4 gap-4">
                    {/* Video Tiles */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <VideoTile
                                track={p1Tracks.camera}
                                label={p1Tracks.identity || "P1"}
                            />
                        </div>
                        <div>
                            <VideoTile
                                track={p2Tracks.camera}
                                label={p2Tracks.identity || "P2"}
                            />
                        </div>
                    </div>

                    {/* Audio Controls */}
                    <div className="flex gap-2">
                        <Button
                            variant={p1Muted ? "destructive" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() => setP1Muted((m) => !m)}
                        >
                            {p1Muted ? <VolumeX className="w-4 h-4 mr-1" /> : <Volume2 className="w-4 h-4 mr-1" />}
                            P1 {p1Muted ? "음소거" : "소리 켜짐"}
                        </Button>
                        <Button
                            variant={p2Muted ? "destructive" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() => setP2Muted((m) => !m)}
                        >
                            {p2Muted ? <VolumeX className="w-4 h-4 mr-1" /> : <Volume2 className="w-4 h-4 mr-1" />}
                            P2 {p2Muted ? "음소거" : "소리 켜짐"}
                        </Button>
                    </div>

                    {/* Current Question Info */}
                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                                현재 문제: Q{currentQuestionIndex + 1}/{questions.length || "-"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                턴: {isP1Turn ? "P1" : "P2"} ({p1Tracks.identity && p2Tracks.identity
                                    ? isP1Turn ? p1Tracks.identity : p2Tracks.identity
                                    : "-"})
                            </span>
                        </div>

                        {currentQuestion && (
                            <div className="text-sm border-l-2 border-primary pl-3">
                                {currentQuestion.content || "(문제 내용 없음)"}
                            </div>
                        )}

                        {/* Answer status */}
                        <div className="space-y-1 text-xs text-muted-foreground">
                            <div>
                                P1 답변: {currentRQ?.submitted_answer || "-"}
                                {currentRQ?.is_correct !== null && (
                                    <span className={currentRQ.is_correct ? "text-green-600 ml-1" : "text-red-600 ml-1"}>
                                        {currentRQ.is_correct ? "(정답)" : "(오답)"}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Turn Timer */}
                    {room?.status === "playing" && (
                        <div className="bg-muted/50 rounded-lg p-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">남은 시간</span>
                                <span className="font-mono tabular-nums text-lg">{formatTime(timeLeft)}</span>
                            </div>
                        </div>
                    )}

                    {/* Room Metadata */}
                    <div className="text-xs text-muted-foreground space-y-1 mt-auto">
                        <div>Room ID: {roomId}</div>
                        <div>Code: {room?.code || "-"}</div>
                        <div>P1 ID: {room?.player1_id?.slice(0, 8) || "-"}</div>
                        <div>P2 ID: {room?.player2_id?.slice(0, 8) || "-"}</div>
                    </div>
                </div>

                {/* Right Panel: Canvas View */}
                <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
                    <div className="w-full h-full max-w-4xl max-h-[80vh] bg-white rounded-xl border shadow-sm flex items-center justify-center overflow-hidden">
                        {strokes.length > 0 ? (
                            <svg
                                viewBox="0 0 800 600"
                                className="w-full h-full"
                                style={{ background: "white" }}
                            >
                                {strokes.map((stroke: any, i: number) => {
                                    if (!stroke.points || stroke.points.length < 2) return null
                                    const d = stroke.points
                                        .map((p: any, idx: number) =>
                                            idx === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`,
                                        )
                                        .join(" ")
                                    return (
                                        <path
                                            key={stroke.id || i}
                                            d={d}
                                            stroke={stroke.color || "#000"}
                                            strokeWidth={stroke.width || 3}
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    )
                                })}
                            </svg>
                        ) : (
                            <div className="text-center text-muted-foreground space-y-2">
                                <div className="text-4xl">
                                    <svg className="w-16 h-16 mx-auto text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium">캔버스 실시간 뷰</p>
                                <p className="text-xs">플레이어가 그리기를 시작하면 여기에 표시됩니다.</p>
                                <p className="text-xs text-muted-foreground/60">
                                    실시간 브로드캐스트 채널을 통해 스트로크를 수신합니다.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* ── Bottom Bar ── */}
            <footer className="h-12 flex items-center justify-between px-6 border-t bg-card text-sm">
                <div className="flex gap-4">
                    <Button
                        variant={p1Muted ? "destructive" : "ghost"}
                        size="sm"
                        onClick={() => setP1Muted((m) => !m)}
                    >
                        {p1Muted ? <VolumeX className="w-3 h-3 mr-1" /> : <Volume2 className="w-3 h-3 mr-1" />}
                        P1 음소거
                    </Button>
                    <Button
                        variant={p2Muted ? "destructive" : "ghost"}
                        size="sm"
                        onClick={() => setP2Muted((m) => !m)}
                    >
                        {p2Muted ? <VolumeX className="w-3 h-3 mr-1" /> : <Volume2 className="w-3 h-3 mr-1" />}
                        P2 음소거
                    </Button>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground">
                    <span>
                        턴: {isP1Turn ? "P1" : "P2"}{" "}
                        ({p1Tracks.identity && p2Tracks.identity
                            ? isP1Turn ? p1Tracks.identity : p2Tracks.identity
                            : "-"})
                    </span>
                    {room?.status === "playing" && (
                        <span className="font-mono tabular-nums">남은: {formatTime(timeLeft)}</span>
                    )}
                </div>
            </footer>
        </div>
    )
}

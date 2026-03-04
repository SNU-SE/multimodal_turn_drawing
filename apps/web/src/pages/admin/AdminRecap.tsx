import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Play, Pause, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FreehandCanvas, type CanvasImage } from "@/components/canvas/FreehandCanvas"
import { supabase } from "@/lib/supabase"

export default function AdminRecap() {
    const { roomId } = useParams()

    const [logs, setLogs] = useState<any[]>([])
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [maxTime, setMaxTime] = useState(0)

    const [displayedStrokes, setDisplayedStrokes] = useState<any[]>([])
    const [displayedImage, setDisplayedImage] = useState<CanvasImage | null>(null)

    // Load logs
    useEffect(() => {
        if (!roomId) return
        const fetchLogs = async () => {
            const { data } = await supabase
                .from('canvas_logs')
                .select('*')
                .eq('room_id', roomId)
                .order('timestamp', { ascending: true })

            if (data && data.length > 0) {
                const logsData = data as any[]
                const start = new Date(logsData[0].timestamp).getTime()
                const normalizedLogs = logsData.map((log: any) => ({
                    ...log,
                    relativeTime: new Date(log.timestamp).getTime() - start
                }))
                setLogs(normalizedLogs)
                setMaxTime(normalizedLogs[normalizedLogs.length - 1].relativeTime)
            }
        }
        fetchLogs()
    }, [roomId])

    // Playback timer
    const timerRef = useRef<any>(null)
    useEffect(() => {
        if (isPlaying) {
            timerRef.current = setInterval(() => {
                setCurrentTime((prev) => {
                    if (prev >= maxTime) {
                        setIsPlaying(false)
                        return maxTime
                    }
                    return prev + 50
                })
            }, 50)
        } else {
            if (timerRef.current) clearInterval(timerRef.current)
        }
        return () => clearInterval(timerRef.current)
    }, [isPlaying, maxTime])

    // Compute displayed strokes + image based on currentTime
    useEffect(() => {
        if (!logs.length) return

        let currentStrokes: any[] = []
        let currentImage: CanvasImage | null = null

        for (const log of logs) {
            if (log.relativeTime > currentTime) break

            if (log.action_type === 'draw_path') {
                currentStrokes.push(log.payload)
            } else if (log.action_type === 'clear') {
                currentStrokes = []
                currentImage = null
            } else if (log.action_type === 'erase' && log.payload?.strokeId) {
                currentStrokes = currentStrokes.filter((s: any) => s.id !== log.payload.strokeId)
            } else if (log.action_type === 'place_image' && log.payload) {
                currentImage = log.payload as CanvasImage
            }
        }

        setDisplayedStrokes(currentStrokes)
        setDisplayedImage(currentImage)
    }, [currentTime, logs])

    const togglePlay = () => {
        if (currentTime >= maxTime) {
            setCurrentTime(0)
        }
        setIsPlaying(!isPlaying)
    }

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCurrentTime(Number(e.target.value))
    }

    return (
        <div className="flex flex-col h-screen bg-background">
            <header className="h-16 flex items-center px-6 border-b shrink-0 bg-card">
                <Link to="/admin" className="p-2 mr-4 hover:bg-muted rounded-md transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="font-bold text-lg">리캡 뷰어 (Recap)</h1>
                    <p className="text-sm text-muted-foreground">세션의 진행 상황을 시간순으로 재생합니다.</p>
                </div>
            </header>

            <main className="flex-1 p-8 flex flex-col items-center">

                {/* Canvas Area */}
                <div className="w-full max-w-4xl flex-1 border rounded-xl bg-white shadow-sm overflow-hidden mb-6 relative">
                    <FreehandCanvas
                        disabled={true}
                        initialStrokes={displayedStrokes}
                        canvasImage={displayedImage}
                    />
                </div>

                {/* Video Scrubber & Controls */}
                <div className="w-full max-w-4xl bg-card border rounded-lg p-4 flex items-center gap-4 shadow-sm">
                    <Button variant="outline" size="icon" onClick={togglePlay} className="shrink-0 w-12 h-12 rounded-full">
                        {isPlaying ? <Pause className="fill-current w-5 h-5" /> : <Play className="fill-current w-5 h-5 ml-1" />}
                    </Button>

                    <Button variant="ghost" size="icon" onClick={() => setCurrentTime(0)} className="shrink-0">
                        <RotateCcw className="w-5 h-5" />
                    </Button>

                    <div className="flex-1 flex items-center gap-4 px-2">
                        <span className="font-mono text-sm tabular-nums">
                            {(currentTime / 1000).toFixed(1)}s
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={maxTime || 100}
                            value={currentTime}
                            onChange={handleSeek}
                            className="flex-1 accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="font-mono text-sm tabular-nums">
                            {(maxTime / 1000).toFixed(1)}s
                        </span>
                    </div>
                </div>

            </main>
        </div>
    )
}

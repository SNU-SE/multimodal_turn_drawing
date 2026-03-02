import { useState, useEffect } from "react"
import { Pointer, Edit3, Trash2, Send, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FreehandCanvas } from "@/components/canvas/FreehandCanvas"
import { useRoomStore } from "@/store/roomStore"

export default function MainGame() {
    const {
        room, isPlayer1, playerId,
        strokes, addStroke, clearStrokes,
        isAnswering, answerText, startAnswer, cancelAnswer, updateAnswerText, submitAnswer, endTurn
    } = useRoomStore()

    // Turn State matching from DB logic (mocked for UI interaction via realtime)
    const turnState = room?.turn_state as any
    // For our mock, we can rely on isPlayer1 from the store and currentPlayerId
    const currentPlayerId = turnState?.currentPlayerId || room?.player1_id
    const isMyTurn = currentPlayerId ? currentPlayerId === playerId : isPlayer1

    const [timeLeft, setTimeLeft] = useState(room?.turn_state ? (turnState.timeLeft || 60) : 60)

    // Current question index from DB
    const currentQuestion = (room?.current_question_index || 0) + 1
    const totalQuestions = 5 // From DB or standard limit

    // Canvas State local to the user
    const [color, setColor] = useState(isPlayer1 ? "#F45B69" : "#3b82f6")
    const [width, setWidth] = useState(6)

    // Timer simulation countdown (syncs back with Server ideally via Realtime broadcasts)
    useEffect(() => {
        if (!turnState?.isPaused && isMyTurn && timeLeft > 0) {
            const timer = setInterval(() => {
                setTimeLeft((prev: number) => prev - 1)
            }, 1000)
            return () => clearInterval(timer)
        }
    }, [turnState?.isPaused, isMyTurn, timeLeft])

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden relative">

            {/* Device Restriction Overlay */}
            <div className="hidden max-md:portrait:flex absolute inset-0 bg-background z-50 flex-col items-center justify-center p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">화면 방향 오류</h2>
                <p className="text-muted-foreground">이 플랫폼은 가로 모드(Landscape) 태블릿 및 PC에 최적화되어 있습니다. 기기를 가로로 회전해주세요.</p>
            </div>

            {/* LEFT 1/3: Question & Answer Sidebar */}
            <aside className="w-1/3 flex flex-col border-r border-border bg-card shrink-0 shadow-sm z-10">

                {/* Header - Question Info */}
                <div className="p-4 border-b bg-muted/20 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <span className="font-mono bg-background border px-2 py-1 rounded-md text-sm font-bold shadow-sm">
                            ROOM {room?.code}
                        </span>
                        <span className="text-sm font-semibold tracking-tight text-primary">
                            문제 {currentQuestion} / {totalQuestions}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xl font-bold tabular-nums ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>
                            00:{timeLeft.toString().padStart(2, '0')}
                        </span>
                    </div>
                </div>

                {/* Question Area */}
                <div className="flex-1 p-6 flex flex-col items-center justify-center border-b bg-white overflow-hidden relative">
                    <p className="text-sm font-medium text-muted-foreground absolute top-4 left-4">Question</p>
                    <div className="w-full h-full max-h-[300px] border-2 border-dashed border-muted-foreground/30 rounded-xl flex items-center justify-center text-muted-foreground bg-muted/10 relative overflow-hidden group">
                        {/* Real app: questions table query for image_url */}
                        <img
                            src="https://images.unsplash.com/photo-1596495577886-d920f1fb7238?w=800&q=80"
                            alt="Question"
                            className="object-contain w-full h-full"
                        />
                    </div>
                </div>

                {/* Answer Area */}
                <div className="h-64 p-6 bg-card flex flex-col justify-end shrink-0">
                    {!isAnswering ? (
                        <div className="space-y-4 w-full h-full flex flex-col justify-end">
                            <div className="text-center w-full">
                                <p className="text-sm text-muted-foreground mb-4">정답을 아시나요? 정답 입력 버튼을 누르면 타이머가 일시정지됩니다.</p>
                            </div>
                            <Button
                                onClick={() => startAnswer()}
                                disabled={!isMyTurn}
                                className="w-full h-14 text-lg font-bold shadow-sm"
                            >
                                <Edit3 className="mr-2" /> 정답 입력하기
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4 w-full h-full flex flex-col justify-end">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold flex items-center gap-2 text-primary">
                                    <CheckCircle2 className="w-4 h-4" /> {isMyTurn ? "정답 작성 중..." : "상대방이 정답 작성 중..."}
                                </h3>
                                <span className="text-xs text-muted-foreground animate-pulse">
                                    {isMyTurn ? "상대방 화면에 실시간 표시됨" : "실시간 전송 중"}
                                </span>
                            </div>
                            <Input
                                value={answerText}
                                onChange={(e) => updateAnswerText(e.target.value)}
                                placeholder="여기에 정답을 입력하세요"
                                className="h-14 text-lg"
                                autoFocus={isMyTurn}
                                readOnly={!isMyTurn}
                            />
                            {isMyTurn && (
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => cancelAnswer()}
                                        className="h-12 flex-1"
                                    >
                                        취소
                                    </Button>
                                    <Button onClick={() => submitAnswer()} className="h-12 flex-1 bg-green-600 hover:bg-green-700">
                                        <Send className="mr-2 w-4 h-4" /> 최종 제출
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </aside>

            {/* RIGHT 2/3: Canvas & Toolbar */}
            <main className="flex-1 flex flex-col bg-muted/10 relative">

                {/* Turn indicator Overlay if NOT my turn */}
                {!isMyTurn && (
                    <div className="absolute inset-0 z-40 bg-background/50 backdrop-blur-[1px] flex flex-col items-center justify-center">
                        <Card className="shadow-xl border-primary/20 bg-card">
                            <CardContent className="p-8 text-center flex flex-col items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-bounce">
                                    <Pointer />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold">상대방의 턴입니다</h3>
                                    <p className="text-muted-foreground mt-2">상대방이 그림을 그리고 있습니다. 관전해주세요.</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Floating Toolbar */}
                <div className={`absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-2 bg-card border rounded-full shadow-lg ${!isMyTurn && 'opacity-50 pointer-events-none'}`}>
                    <div className="flex items-center gap-1 px-2 border-r pr-4">
                        {["#F45B69", "#22181C", "#3b82f6", "#10b981", "#f59e0b"].map((c) => (
                            <button
                                key={c}
                                onClick={() => setColor(c)}
                                className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-foreground shadow-md' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-1 px-4 border-r">
                        {[2, 6, 12].map((w) => (
                            <button
                                key={w}
                                onClick={() => setWidth(w)}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${width === w ? 'bg-muted' : 'hover:bg-muted/50'}`}
                            >
                                <div className="bg-foreground rounded-full" style={{ width: w + 2, height: w + 2 }} />
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 pl-2 pr-2">
                        <Button variant="ghost" size="icon" className="rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => clearStrokes()}>
                            <Trash2 className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {/* Canvas Content */}
                <div className="flex-1 p-6 relative">
                    <div className="absolute inset-6 rounded-2xl overflow-hidden shadow-sm border bg-white">
                        <FreehandCanvas
                            color={color}
                            width={width}
                            disabled={!isMyTurn || isAnswering}
                            initialStrokes={strokes}
                            onStrokeEnd={(s) => addStroke(s)}
                        />
                    </div>
                </div>

                {/* Bottom Turn Actions */}
                <div className="absolute bottom-6 right-6 z-30">
                    <Button
                        onClick={() => endTurn()}
                        variant="outline"
                        className="rounded-full bg-card shadow-md border px-6 hover:text-primary transition-colors"
                        disabled={!isMyTurn || isAnswering}
                    >
                        내 턴 넘기기
                    </Button>
                </div>
            </main>
        </div>
    )
}

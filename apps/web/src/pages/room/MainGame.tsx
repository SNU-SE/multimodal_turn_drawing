import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Pointer, Edit3, Trash2, Send, CheckCircle2, Trophy, Eraser, ImageIcon, RotateCcw, ArrowLeft, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FreehandCanvas } from "@/components/canvas/FreehandCanvas"
import { useRoomStore } from "@/store/roomStore"
import { supabase } from "@/lib/supabase"

export default function MainGame() {
    const {
        room, isPlayer1, playerId, questions,
        strokes, addStroke, eraseStroke, clearStrokes,
        partnerActiveStroke, updateActiveStroke,
        isAnswering, answerText, startAnswer, cancelAnswer, updateAnswerText, submitAnswer, advanceQuestion, endTurn,
        lastAnswerResult, clearAnswerResult,
        canvasImage, placeImage, updateImage,
        backToReview, fetchRoomQuestions,
        goToPreviousQuestion,
        requestRetry, requestComplete, approveRequest, rejectRequest,
        sessionTimeLimit,
        logEvent,
        turnAcknowledged,
    } = useRoomStore()

    const navigate = useNavigate()

    // Turn State
    const turnState = room?.turn_state as any
    const currentPlayerId = turnState?.currentPlayerId || room?.player1_id
    const isMyTurn = currentPlayerId ? currentPlayerId === playerId : isPlayer1
    const isReviewMode = !!(turnState?.isReviewMode)

    const [timeLeft, setTimeLeft] = useState(room?.turn_state ? (turnState.timeLeft || 60) : 60)

    // Canvas tool modes
    const [eraserMode, setEraserMode] = useState(false)
    const [imageEditMode, setImageEditMode] = useState(false)

    // Auto-close countdown for session expiry
    const [autoCloseCountdown, setAutoCloseCountdown] = useState<number | null>(null)

    // Answer feedback
    useEffect(() => {
        if (lastAnswerResult) {
            const t = setTimeout(() => clearAnswerResult(), 3000)
            return () => clearTimeout(t)
        }
    }, [lastAnswerResult, clearAnswerResult])

    // Current question
    const currentQuestionIndex = room?.current_question_index || 0
    const currentQuestionNum = currentQuestionIndex + 1
    const currentQuestionObj = questions[currentQuestionIndex]
    const totalQuestions = questions.length || 0

    // Multiple choice
    const isMC = currentQuestionObj?.question_type === 'multiple_choice'
    const mcOptions: string[] = isMC ? (currentQuestionObj?.options as string[] || []) : []
    const correctAnswerStr = currentQuestionObj?.correct_answer || ''
    const correctIndices = correctAnswerStr.split(',').filter(Boolean)
    const isMultiAnswer = correctIndices.length > 1

    const [mcSelected, setMcSelected] = useState<string[]>([])

    // Reset MC selection when question changes
    useEffect(() => { setMcSelected([]) }, [currentQuestionIndex])

    // Sync partner's MC selection in real-time
    useEffect(() => {
        if (!isMyTurn && isAnswering && isMC && answerText) {
            setMcSelected(answerText.split(',').filter(Boolean))
        }
        if (!isAnswering) setMcSelected([])
    }, [isMyTurn, isAnswering, isMC, answerText])

    // Session countdown
    const sessionStartedAt = turnState?.sessionStartedAt as string | undefined
    const hasSessionLimit = !!(sessionTimeLimit && sessionTimeLimit > 0 && sessionStartedAt)

    const [sessionSecondsLeft, setSessionSecondsLeft] = useState<number | null>(null)

    useEffect(() => {
        if (!hasSessionLimit) { setSessionSecondsLeft(null); return }

        const totalSeconds = sessionTimeLimit! * 60
        const update = () => {
            const elapsed = (Date.now() - new Date(sessionStartedAt!).getTime()) / 1000
            const remaining = Math.max(0, Math.ceil(totalSeconds - elapsed))
            setSessionSecondsLeft(remaining)
        }
        update()
        const id = setInterval(update, 1000)
        return () => clearInterval(id)
    }, [hasSessionLimit, sessionTimeLimit, sessionStartedAt])

    // Session timer tick — log every 10 minutes
    useEffect(() => {
        if (!hasSessionLimit || room?.status !== 'playing') return
        const id = setInterval(() => {
            const state = useRoomStore.getState()
            const ts = state.room?.turn_state as any
            if (!ts?.sessionStartedAt) return
            const elapsed = (Date.now() - new Date(ts.sessionStartedAt).getTime()) / 1000
            logEvent('session_timer_tick', {
                sessionSecondsLeft: Math.max(0, Math.ceil((state.sessionTimeLimit! * 60) - elapsed)),
                elapsedMinutes: Math.floor(elapsed / 60),
                questionIndex: state.room?.current_question_index || 0,
            })
        }, 10 * 60 * 1000)
        return () => clearInterval(id)
    }, [hasSessionLimit, room?.status])

    // Auto-complete when session time expires (player1 only to avoid duplicate)
    useEffect(() => {
        if (sessionSecondsLeft === 0 && room?.status === 'playing' && isPlayer1) {
            ;(async () => {
                const payload = { status: 'completed' as const }
                await (supabase as any).from('rooms').update(payload).eq('id', room.id)
                const updatedRoom = { ...room, ...payload }
                useRoomStore.getState().broadcastRoomUpdate(updatedRoom)
            })()
        }
    }, [sessionSecondsLeft, room?.status, isPlayer1])

    // Start auto-close countdown when session expires on completed screen
    useEffect(() => {
        if (room?.status === 'completed' && hasSessionLimit && sessionSecondsLeft === 0 && autoCloseCountdown === null) {
            setAutoCloseCountdown(5)
        }
    }, [room?.status, hasSessionLimit, sessionSecondsLeft])

    // Auto-close countdown tick → navigate home
    useEffect(() => {
        if (autoCloseCountdown === null) return
        if (autoCloseCountdown <= 0) { navigate('/'); return }
        const timer = setTimeout(() => setAutoCloseCountdown(prev => prev! - 1), 1000)
        return () => clearTimeout(timer)
    }, [autoCloseCountdown])

    // Canvas State
    const [color, setColor] = useState(isPlayer1 ? "#F45B69" : "#5386E4")
    const [width, setWidth] = useState(6)

    // Guard to prevent double-firing endTurn
    const isEndingTurnRef = useRef(false)

    const handleEndTurn = async (reason?: 'manual' | 'timer_expired') => {
        if (isEndingTurnRef.current || !isMyTurn) return
        isEndingTurnRef.current = true
        try {
            await endTurn(reason)
        } finally {
            setTimeout(() => { isEndingTurnRef.current = false }, 2000)
        }
    }

    // Guard to prevent double-firing requestRetry
    const isRequestingRetryRef = useRef(false)

    const handleRequestRetry = async (idx: number) => {
        if (isRequestingRetryRef.current) return
        isRequestingRetryRef.current = true
        try {
            await requestRetry(idx)
        } finally {
            setTimeout(() => { isRequestingRetryRef.current = false }, 2000)
        }
    }

    // Auto-disable eraser/image mode when selecting color/width
    const handleColorSelect = (c: string) => {
        setColor(c)
        setEraserMode(false)
        setImageEditMode(false)
    }
    const handleWidthSelect = (w: number) => {
        setWidth(w)
        setEraserMode(false)
        setImageEditMode(false)
    }

    // Timer countdown (both players see it decrease in sync)
    useEffect(() => {
        if (turnState?.isPaused || timeLeft <= 0) return
        const timer = setInterval(() => {
            setTimeLeft((prev: number) => prev - 1)
        }, 1000)
        return () => clearInterval(timer)
    }, [turnState?.isPaused, timeLeft])

    // Auto-end turn when timer hits 0 (only if server acknowledged the last turn switch)
    useEffect(() => {
        if (timeLeft === 0 && isMyTurn && turnAcknowledged) {
            handleEndTurn('timer_expired')
        }
    }, [timeLeft, isMyTurn, turnAcknowledged])

    // Reset local time when turn switches or question advances
    useEffect(() => {
        if (turnState?.timeLeft) {
            setTimeLeft(turnState.timeLeft)
        }
    }, [turnState?.currentPlayerId, currentQuestionIndex, turnState?.timeLeft])

    // Approval system state
    const pendingRequest = turnState?.pendingRequest as {
        type: 'retry' | 'complete'
        requestedBy: string
        questionIndex?: number
    } | null
    const gameFinished = !!(turnState?.gameFinished)
    const isRequester = pendingRequest?.requestedBy === playerId
    const isApprover = !!pendingRequest && !isRequester
    const hasPendingRequest = !!pendingRequest

    // Navigate home when game is finished (both players approved)
    useEffect(() => {
        if (gameFinished) navigate('/')
    }, [gameFinished])

    // Fetch room questions when game completes
    useEffect(() => {
        if (room?.status === 'completed') {
            fetchRoomQuestions()
        }
    }, [room?.status])

    // ReviewSummary Screen (completed + not in review mode)
    if (room?.status === 'completed' && !isReviewMode) {
        const sessionExpired = hasSessionLimit && sessionSecondsLeft !== null && sessionSecondsLeft <= 0

        return (
            <div className="flex h-screen w-full bg-background items-center justify-center">
                <Card className="shadow-2xl border-primary/20 max-w-2xl w-full mx-4">
                    <CardContent className="p-8 flex flex-col items-center gap-6">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                            <Trophy className="w-8 h-8 text-primary" />
                        </div>
                        <div className="text-center">
                            <h2 className="text-2xl font-bold mb-1">모든 문제 완료!</h2>
                            {sessionExpired && autoCloseCountdown !== null ? (
                                <p className="text-destructive font-medium">
                                    {autoCloseCountdown}초 후 자동으로 종료됩니다
                                </p>
                            ) : (
                                <p className="text-muted-foreground">총 {totalQuestions}문제를 풀었습니다</p>
                            )}
                        </div>

                        {/* Question Results List */}
                        <div className="w-full max-h-[180px] overflow-y-auto space-y-2">
                            {questions.map((q, idx) => {
                                return (
                                    <div key={q.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 border-muted">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {idx + 1}. {(q.content || q.title || '문제').slice(0, 10)}...
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRequestRetry(idx)}
                                            disabled={hasPendingRequest || isRequestingRetryRef.current || !!sessionExpired}
                                            className="shrink-0"
                                        >
                                            <RotateCcw className="w-3 h-3 mr-1" /> 재시도
                                        </Button>
                                    </div>
                                )
                            })}
                        </div>

                        <Button
                            variant="outline"
                            className="w-full mt-2"
                            onClick={() => requestComplete()}
                            disabled={hasPendingRequest}
                        >
                            종료하기
                        </Button>
                    </CardContent>
                </Card>

                {/* Approval Dialog (shown to approver) */}
                {isApprover && pendingRequest && (
                    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center">
                        <Card className="max-w-sm w-full mx-4 shadow-2xl">
                            <CardContent className="p-6 flex flex-col items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                                    {pendingRequest.type === 'retry'
                                        ? <RotateCcw className="w-6 h-6 text-amber-700" />
                                        : <Trophy className="w-6 h-6 text-amber-700" />}
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-bold">
                                        {pendingRequest.type === 'retry'
                                            ? `문제 ${(pendingRequest.questionIndex ?? 0) + 1} 재시도 요청`
                                            : '게임 종료 요청'}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {pendingRequest.type === 'retry'
                                            ? '상대방이 이 문제를 다시 풀자고 요청합니다.'
                                            : '상대방이 게임을 종료하자고 요청합니다.'}
                                    </p>
                                </div>
                                <div className="flex gap-3 w-full">
                                    <Button variant="outline" className="flex-1" onClick={() => rejectRequest()}>
                                        거절
                                    </Button>
                                    <Button className="flex-1" onClick={() => approveRequest()}>
                                        승인
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Waiting UI (shown to requester) */}
                {isRequester && pendingRequest && (
                    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center">
                        <Card className="max-w-sm w-full mx-4 shadow-2xl">
                            <CardContent className="p-6 flex flex-col items-center gap-4">
                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                                <div className="text-center">
                                    <h3 className="text-lg font-bold">
                                        {pendingRequest.type === 'retry' ? '재시도 요청 전송됨' : '종료 요청 전송됨'}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        상대방의 승인을 기다리는 중...
                                    </p>
                                </div>
                                <Button variant="outline" className="w-full" onClick={() => rejectRequest()}>
                                    요청 취소
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative">

            {/* Session Countdown Bar */}
            {hasSessionLimit && sessionSecondsLeft !== null && room?.status === 'playing' && (
                <div className={`w-full shrink-0 px-4 py-1.5 text-center border-b ${
                    sessionSecondsLeft <= 60
                        ? 'bg-red-100 border-red-300'
                        : sessionSecondsLeft <= 300
                            ? 'bg-amber-100 border-amber-300'
                            : 'bg-blue-50 border-blue-200'
                }`}>
                    <span className={`text-sm font-medium tabular-nums ${
                        sessionSecondsLeft <= 60 ? 'text-red-800 animate-pulse' : sessionSecondsLeft <= 300 ? 'text-amber-800' : 'text-blue-800'
                    }`}>
                        세션 남은 시간: {Math.floor(sessionSecondsLeft / 60)}분 {sessionSecondsLeft % 60}초
                    </span>
                </div>
            )}

            {/* Main content row */}
            <div className="flex flex-1 overflow-hidden relative">

            {/* Device Restriction Overlay */}
            <div className="hidden max-md:portrait:flex absolute inset-0 bg-background z-50 flex-col items-center justify-center p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">화면 방향 오류</h2>
                <p className="text-muted-foreground">이 플랫폼은 가로 모드(Landscape) 태블릿 및 PC에 최적화되어 있습니다. 기기를 가로로 회전해주세요.</p>
            </div>

            {/* Answer Feedback Toast */}
            {lastAnswerResult && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 rounded-full shadow-xl text-white font-bold text-lg transition-all bg-primary">
                    <Send className="w-5 h-5" /> 답변이 제출되었습니다
                </div>
            )}

            {/* LEFT 1/3: Question & Answer Sidebar */}
            <aside className="w-1/3 flex flex-col border-r border-border bg-card shrink-0 shadow-sm z-10">

                {/* Header - Question Info */}
                <div className="p-4 border-b bg-muted/20 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <span className="font-mono bg-background border px-2 py-1 rounded-md text-sm font-bold shadow-sm">
                            ROOM {room?.code}
                        </span>
                        <span className="text-sm font-semibold tracking-tight text-primary">
                            문제 {currentQuestionNum} / {totalQuestions}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {isReviewMode && (
                            <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">재시도</span>
                        )}
                        <span className={`text-xl font-bold tabular-nums ${timeLeft <= 10 ? 'text-destructive animate-pulse' : ''}`}>
                            {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
                        </span>
                    </div>
                </div>

                {/* Question Area */}
                <div className="flex-1 p-6 flex flex-col items-center justify-center border-b bg-white overflow-hidden relative">
                    <p className="text-sm font-medium text-muted-foreground absolute top-4 left-4">Question</p>
                    <div className="w-full h-full flex flex-col items-center justify-center gap-4 overflow-auto">
                        {/* Content text */}
                        {currentQuestionObj?.content && (
                            <p className="text-lg font-medium text-center px-4 leading-relaxed">
                                {currentQuestionObj.content}
                            </p>
                        )}

                        {/* Content image */}
                        {currentQuestionObj?.content_image_url && (
                            <img
                                src={currentQuestionObj.content_image_url}
                                alt="Question content"
                                className="max-h-[200px] object-contain rounded-lg border"
                            />
                        )}

                        {/* Question image */}
                        {currentQuestionObj?.image_url && (
                            <div className="w-full max-h-[300px] border-2 border-dashed border-muted-foreground/30 rounded-xl flex items-center justify-center bg-muted/10 overflow-hidden">
                                <img
                                    src={currentQuestionObj.image_url}
                                    alt="Question"
                                    className="object-contain w-full h-full"
                                />
                            </div>
                        )}

                        {/* Fallback: no content at all */}
                        {!currentQuestionObj?.content && !currentQuestionObj?.content_image_url && !currentQuestionObj?.image_url && (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <span className="text-sm">문제를 불러오는 중...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Answer Area */}
                <div className="h-auto min-h-64 p-6 bg-card flex flex-col justify-end shrink-0">
                    {!isAnswering ? (
                        <div className="space-y-4 w-full h-full flex flex-col justify-end">
                            <div className="text-center w-full">
                                <p className="text-sm text-muted-foreground mb-4">
                                    {isReviewMode
                                        ? '다시 도전해보세요!'
                                        : `정답을 아시나요? ${isMC ? '정답 선택' : '정답 입력'} 버튼을 누르면 타이머가 일시정지됩니다.`}
                                </p>
                            </div>
                            <Button
                                onClick={() => startAnswer()}
                                disabled={!isMyTurn}
                                className="w-full h-14 text-lg font-bold shadow-sm"
                            >
                                <Edit3 className="mr-2" /> {isMC ? '정답 선택하기' : '정답 입력하기'}
                            </Button>
                            {isReviewMode ? (
                                <Button
                                    variant="ghost"
                                    onClick={() => backToReview()}
                                    disabled={!isMyTurn}
                                    className="w-full h-10 text-muted-foreground hover:text-foreground"
                                >
                                    <ArrowLeft className="mr-1 w-4 h-4" /> 리뷰로 돌아가기
                                </Button>
                            ) : (
                                <div className="flex gap-2">
                                    {currentQuestionIndex > 0 && (
                                        <Button
                                            variant="ghost"
                                            onClick={() => goToPreviousQuestion()}
                                            disabled={!isMyTurn}
                                            className="flex-1 h-10 text-muted-foreground hover:text-foreground"
                                        >
                                            <ArrowLeft className="mr-1 w-4 h-4" /> 이전
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        onClick={() => advanceQuestion()}
                                        disabled={!isMyTurn}
                                        className="flex-1 h-10 text-muted-foreground hover:text-foreground"
                                    >
                                        {currentQuestionIndex >= totalQuestions - 1
                                            ? '최종 제출'
                                            : <><ChevronRight className="mr-1 w-4 h-4" /> 다음</>
                                        }
                                    </Button>
                                </div>
                            )}
                        </div>
                    ) : isMC ? (
                        /* Multiple Choice UI */
                        <div className="space-y-3 w-full h-full flex flex-col justify-end">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold flex items-center gap-2 text-primary">
                                    <CheckCircle2 className="w-4 h-4" /> {isMyTurn ? "정답 선택 중..." : "상대방이 정답 선택 중..."}
                                </h3>
                                {isMultiAnswer && (
                                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                                        정답을 모두 고르시오
                                    </span>
                                )}
                            </div>
                            <div className="space-y-2">
                                {mcOptions.map((option, idx) => {
                                    const optionIndex = String(idx + 1)
                                    const isSelected = mcSelected.includes(optionIndex)
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                if (!isMyTurn) return
                                                let next: string[]
                                                if (isMultiAnswer) {
                                                    next = isSelected
                                                        ? mcSelected.filter(v => v !== optionIndex)
                                                        : [...mcSelected, optionIndex]
                                                } else {
                                                    next = isSelected ? [] : [optionIndex]
                                                }
                                                next.sort()
                                                setMcSelected(next)
                                                updateAnswerText(next.join(','))
                                                logEvent('mc_option_toggle', {
                                                    optionIndex, selected: !isSelected,
                                                    currentSelection: next, questionIndex: currentQuestionIndex,
                                                })
                                            }}
                                            disabled={!isMyTurn}
                                            className={`w-full text-left p-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                                                isSelected
                                                    ? 'border-primary bg-primary/5 text-primary font-semibold'
                                                    : 'border-muted hover:border-muted-foreground/30'
                                            } ${!isMyTurn ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
                                        >
                                            <span className={`w-6 h-6 flex items-center justify-center rounded-${isMultiAnswer ? 'md' : 'full'} border-2 text-xs font-bold shrink-0 ${
                                                isSelected ? 'border-primary bg-primary text-white' : 'border-muted-foreground/40'
                                            }`}>
                                                {isSelected ? '✓' : optionIndex}
                                            </span>
                                            <span className="text-sm">{option}</span>
                                        </button>
                                    )
                                })}
                            </div>
                            {isMyTurn && (
                                <div className="flex gap-2 pt-1">
                                    <Button
                                        variant="outline"
                                        onClick={() => { setMcSelected([]); cancelAnswer() }}
                                        className="h-12 flex-1"
                                    >
                                        취소
                                    </Button>
                                    <Button
                                        onClick={() => submitAnswer()}
                                        className="h-12 flex-1 bg-green-600 hover:bg-green-700"
                                        disabled={mcSelected.length === 0}
                                    >
                                        <Send className="mr-2 w-4 h-4" /> 최종 제출
                                    </Button>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Essay/Text UI */
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
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && isMyTurn) submitAnswer()
                                }}
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
                                    <Button
                                        onClick={() => submitAnswer()}
                                        className="h-12 flex-1 bg-green-600 hover:bg-green-700"
                                        disabled={!answerText.trim()}
                                    >
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

                {/* Turn indicator banner if NOT my turn */}
                {!isMyTurn && (
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40
                        flex items-center gap-2 px-5 py-2.5
                        bg-card/90 backdrop-blur-sm border rounded-full shadow-lg
                        text-sm font-medium text-muted-foreground">
                        <Pointer className="w-4 h-4 text-primary animate-bounce" />
                        상대방의 턴입니다 — 관전 중
                    </div>
                )}

                {/* Floating Toolbar */}
                <div className={`absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 p-2 bg-card border rounded-full shadow-lg ${!isMyTurn && 'hidden'}`}>
                    <div className="flex items-center gap-1 px-2 border-r pr-4">
                        {["#F45B69", "#22181C", "#5386E4", "#63A375", "#f59e0b"].map((c) => (
                            <button
                                key={c}
                                onClick={() => handleColorSelect(c)}
                                className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c && !eraserMode && !imageEditMode ? 'scale-110 border-foreground shadow-md' : 'border-transparent hover:scale-105'}`}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-1 px-4 border-r">
                        {[2, 6, 12].map((w) => (
                            <button
                                key={w}
                                onClick={() => handleWidthSelect(w)}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${width === w && !eraserMode && !imageEditMode ? 'bg-muted' : 'hover:bg-muted/50'}`}
                            >
                                <div className="bg-foreground rounded-full" style={{ width: w + 2, height: w + 2 }} />
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 pl-2 pr-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`rounded-full ${eraserMode ? 'bg-primary/15 text-primary ring-2 ring-primary/30' : 'hover:bg-muted/50'}`}
                            onClick={() => {
                                setEraserMode(!eraserMode)
                                setImageEditMode(false)
                            }}
                        >
                            <Eraser className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`rounded-full ${imageEditMode ? 'bg-blue-500/15 text-blue-600 ring-2 ring-blue-500/30' : 'hover:bg-muted/50'}`}
                            onClick={() => {
                                if (!canvasImage && currentQuestionObj?.image_url) {
                                    placeImage(currentQuestionObj.image_url)
                                    setImageEditMode(true)
                                } else {
                                    setImageEditMode(!imageEditMode)
                                }
                                setEraserMode(false)
                            }}
                        >
                            <ImageIcon className="w-5 h-5" />
                        </Button>
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
                            partnerStroke={partnerActiveStroke}
                            onStrokeUpdate={(s) => updateActiveStroke(s)}
                            onStrokeEnd={(s) => {
                                updateActiveStroke(null)
                                addStroke(s)
                            }}
                            eraserMode={eraserMode}
                            onEraseStroke={(id) => eraseStroke(id)}
                            canvasImage={canvasImage}
                            imageEditMode={imageEditMode}
                            onImageUpdate={(img) => useRoomStore.setState({ canvasImage: img })}
                            onImageUpdateEnd={(img) => updateImage(img)}
                        />
                    </div>
                </div>

                {/* Bottom Turn Actions */}
                <div className="absolute bottom-6 right-6 z-30 flex gap-2">
                    {isReviewMode && (
                        <Button
                            onClick={() => backToReview()}
                            variant="outline"
                            className="rounded-full bg-card shadow-md border px-6 hover:text-amber-700 transition-colors"
                        >
                            <ArrowLeft className="mr-2 w-4 h-4" /> 내 턴 넘기기
                        </Button>
                    )}
                    {!isReviewMode && (
                        <Button
                            onClick={() => handleEndTurn('manual')}
                            variant="outline"
                            className="rounded-full bg-card shadow-md border px-6 hover:text-primary transition-colors"
                            disabled={!isMyTurn || isAnswering || isEndingTurnRef.current}
                        >
                            내 턴 넘기기
                        </Button>
                    )}
                </div>
            </main>

            </div>
        </div>
    )
}

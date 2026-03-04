import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Database } from '@turn-based-drawing/supabase'
import { logger } from "@/lib/logger"
import type { CanvasImage } from '@/components/canvas/FreehandCanvas'

type RoomRow = Database['public']['Tables']['rooms']['Row']

interface RoomState {
    // Session & Connection
    room: RoomRow | null
    roomId: string | null
    playerId: string | null
    isPlayer1: boolean
    isConnected: boolean
    error: string | null
    questions: any[]
    roomQuestions: Array<{ question_id: string; submitted_answer: string | null; is_correct: boolean | null }>

    // Gameplay State
    partnerReady: boolean
    isReady: boolean
    timeLeft: number
    strokes: any[]
    partnerActiveStroke: any | null
    answerText: string
    isAnswering: boolean
    lastAnswerResult: { answer: string; isCorrect: boolean; questionIndex: number } | null
    canvasImage: CanvasImage | null

    // Actions
    joinRoom: (code: string) => Promise<void>
    leaveRoom: () => void
    toggleReady: () => void
    cleanup: () => void

    // Canvas Actions
    addStroke: (stroke: any) => void
    eraseStroke: (strokeId: string) => void
    updateActiveStroke: (stroke: any | null) => void
    clearStrokes: () => void
    clearAnswerResult: () => void
    placeImage: (url: string) => void
    updateImage: (image: CanvasImage) => void

    // Turn Actions
    startAnswer: () => void
    cancelAnswer: () => void
    updateAnswerText: (text: string) => void
    submitAnswer: () => Promise<void>
    advanceQuestion: () => Promise<void>
    endTurn: (reason?: 'manual' | 'timer_expired') => Promise<void>

    broadcastRoomUpdate: (updatedRoom: RoomRow) => void

    // Review Mode Actions
    fetchRoomQuestions: () => Promise<void>
    goToReviewQuestion: (questionIndex: number) => Promise<void>
    backToReview: () => Promise<void>

    // Approval System Actions
    requestRetry: (questionIndex: number) => Promise<void>
    requestComplete: () => Promise<void>
    approveRequest: () => Promise<void>
    rejectRequest: () => Promise<void>
}

export const useRoomStore = create<RoomState>((set, get) => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollIntervalId: any = null
    let strokePollIntervalId: any = null
    let lastStrokeTimestamp: string | null = null
    let groupTimeLimit: number | null = null

    const resolveTimeLimit = (qDefault?: number) => groupTimeLimit ?? qDefault ?? 60

    // ── Fire-and-forget broadcast (best effort, no ack) ──
    const trySend = (event: string, payload: any) => {
        if (!channel) return
        channel.send({ type: 'broadcast', event, payload }).catch(() => {})
    }

    const logTurnEvent = (eventType: string, metadata: Record<string, any> = {}) => {
        const { roomId, playerId } = get()
        if (!roomId) return
        logger.info(`[logTurnEvent] ${eventType}`, metadata)
        supabase.from('turns_log' as any).insert({
            room_id: roomId,
            player_id: playerId,
            event_type: eventType,
            metadata
        } as any).then(({ error }) => {
            if (error) logger.error('[logTurnEvent] DB 저장 실패:', error)
        })
    }

    // ── Room polling (2s interval) ──
    const startRoomPolling = () => {
        if (pollIntervalId) clearInterval(pollIntervalId)
        pollIntervalId = setInterval(async () => {
            const { roomId } = get()
            if (!roomId) return
            const { data, error } = await supabase
                .from('rooms')
                .select('*')
                .eq('id', roomId)
                .single()
            if (error) {
                logger.error('[poll:room] 조회 실패:', error.message)
                return
            }
            if (!data) return
            const currentRoom = get().room
            const newRoom = data as RoomRow
            // Only update if something changed
            const currentTS = JSON.stringify(currentRoom?.turn_state)
            const newTS = JSON.stringify(newRoom.turn_state)
            if (currentRoom?.status !== newRoom.status || currentTS !== newTS || currentRoom?.current_question_index !== newRoom.current_question_index) {
                logger.info('[poll:room] 변경 감지:', { status: newRoom.status, turn_state: newRoom.turn_state, qIdx: newRoom.current_question_index })
                set({ room: newRoom })
            }
        }, 2000)
    }

    // ── Stroke polling (2s interval) — fetch new canvas_logs since last check ──
    const startStrokePolling = () => {
        if (strokePollIntervalId) clearInterval(strokePollIntervalId)
        strokePollIntervalId = setInterval(async () => {
            const { roomId, playerId } = get()
            if (!roomId) return

            let query = (supabase as any)
                .from('canvas_logs')
                .select('*')
                .eq('room_id', roomId)
                .neq('player_id', playerId) // Only partner's strokes
                .order('timestamp', { ascending: true })

            if (lastStrokeTimestamp) {
                query = query.gt('timestamp', lastStrokeTimestamp)
            }

            const { data, error } = await query
            if (error) {
                logger.error('[poll:strokes] 조회 실패:', error.message)
                return
            }
            if (!data || data.length === 0) return

            logger.info(`[poll:strokes] 새 획 ${data.length}개 수신`)

            const newStrokes: any[] = []
            const eraseIds = new Set<string>()
            let shouldClear = false
            let latestImage: CanvasImage | null | undefined = undefined

            for (const log of data) {
                if (log.action_type === 'clear') {
                    shouldClear = true
                    newStrokes.length = 0
                    eraseIds.clear()
                    latestImage = null
                } else if (log.action_type === 'draw_path' && log.payload) {
                    newStrokes.push(log.payload)
                } else if (log.action_type === 'erase' && log.payload?.strokeId) {
                    eraseIds.add(log.payload.strokeId)
                } else if (log.action_type === 'place_image' && log.payload) {
                    latestImage = log.payload as CanvasImage
                }
                lastStrokeTimestamp = log.timestamp
            }

            if (shouldClear) {
                const updates: any = { strokes: [...newStrokes] }
                if (latestImage !== undefined) updates.canvasImage = latestImage
                set(() => updates)
            } else {
                set((state) => {
                    let strokes = state.strokes
                    if (eraseIds.size > 0) {
                        strokes = strokes.filter((s: any) => !eraseIds.has(s.id))
                    }
                    if (newStrokes.length > 0) {
                        strokes = [...strokes, ...newStrokes]
                    }
                    const updates: any = { strokes }
                    if (latestImage !== undefined) updates.canvasImage = latestImage
                    return updates
                })
            }
        }, 2000)
    }

    const stopPolling = () => {
        if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null }
        if (strokePollIntervalId) { clearInterval(strokePollIntervalId); strokePollIntervalId = null }
    }

    return {
        room: null,
        roomId: null,
        playerId: null,
        isPlayer1: false,
        isConnected: false,
        error: null,

        partnerReady: false,
        isReady: false,
        timeLeft: 60,
        strokes: [],
        partnerActiveStroke: null,
        answerText: "",
        isAnswering: false,
        lastAnswerResult: null,
        canvasImage: null,
        questions: [],
        roomQuestions: [],

        joinRoom: async (code: string) => {
            logger.info('[joinRoom] 입장 시도:', code)
            set({ error: null })
            try {
                const { data, error } = await supabase
                    .from('rooms')
                    .select('*')
                    .or(`player1_invite_code.eq.${code},player2_invite_code.eq.${code}`)
                    .single()

                const room = data as RoomRow | null

                if (error || !room) {
                    logger.error('[joinRoom] 방 조회 실패:', error)
                    throw new Error('올바르지 않은 접속 코드입니다.')
                }

                logger.info('[joinRoom] 방 찾음:', { roomId: room.id, status: room.status })

                const isPlayer1 = room.player1_invite_code === code
                const assignedPlayerId = isPlayer1 ? room.player1_id : room.player2_id

                if (!assignedPlayerId) {
                    throw new Error('이 자리에 할당된 참가자 정보가 없습니다.')
                }

                logger.info('[joinRoom] 플레이어 할당:', { isPlayer1, playerId: assignedPlayerId })

                // Fetch questions
                const { data: qData, error: qError } = await (supabase as any)
                    .from('room_questions')
                    .select('*, questions(*)')
                    .eq('room_id', room.id)
                    .order('created_at', { ascending: true })

                if (qError) logger.error('[joinRoom] room_questions 조회 실패:', qError)

                let questions = qData?.map((q: any) => q.questions).filter(Boolean) || []
                const roomQuestions = qData?.map((q: any) => ({
                    question_id: q.question_id,
                    submitted_answer: q.submitted_answer,
                    is_correct: q.is_correct,
                })) || []
                logger.info(`[joinRoom] 문제 ${questions.length}개 로드`)

                // Fetch group time_limit
                if (room.group_id) {
                    const { data: groupInfo } = await (supabase as any)
                        .from('room_groups')
                        .select('question_ids, time_limit')
                        .eq('id', room.group_id)
                        .single()

                    if (groupInfo) {
                        groupTimeLimit = groupInfo.time_limit ?? null
                        logger.info('[joinRoom] 그룹 시간 제한:', groupTimeLimit)

                        if (questions.length === 0 && groupInfo.question_ids?.length > 0) {
                            logger.warn('[joinRoom] room_questions 없음, 그룹 fallback 시도')
                            const { data: fallbackQData } = await (supabase as any)
                                .from('questions')
                                .select('*')
                                .in('id', groupInfo.question_ids)
                            questions = fallbackQData || []
                            logger.info(`[joinRoom] fallback 문제 ${questions.length}개 로드`)
                        }
                    }
                }

                // ── Load existing strokes from canvas_logs ──
                const { data: existingLogs } = await (supabase as any)
                    .from('canvas_logs')
                    .select('*')
                    .eq('room_id', room.id)
                    .order('timestamp', { ascending: true })

                const existingStrokes: any[] = []
                let existingImage: CanvasImage | null = null
                if (existingLogs) {
                    for (const log of existingLogs) {
                        if (log.action_type === 'clear') {
                            existingStrokes.length = 0
                            existingImage = null
                        } else if (log.action_type === 'draw_path' && log.payload) {
                            existingStrokes.push(log.payload)
                        } else if (log.action_type === 'erase' && log.payload?.strokeId) {
                            const idx = existingStrokes.findIndex((s: any) => s.id === log.payload.strokeId)
                            if (idx !== -1) existingStrokes.splice(idx, 1)
                        } else if (log.action_type === 'place_image' && log.payload) {
                            existingImage = log.payload as CanvasImage
                        }
                        lastStrokeTimestamp = log.timestamp
                    }
                    logger.info(`[joinRoom] 기존 획 ${existingStrokes.length}개 로드`)
                }

                set({
                    room, roomId: room.id, playerId: assignedPlayerId,
                    isPlayer1, isConnected: true, questions, roomQuestions,
                    strokes: existingStrokes, canvasImage: existingImage
                })

                // ── Realtime 채널 (best-effort broadcast + Postgres Changes) ──
                logger.info('[joinRoom] Realtime 채널 생성')
                channel = supabase.channel(`room:${room.id}`, {
                    config: {
                        broadcast: { self: false },
                        presence: { key: assignedPlayerId }
                    }
                })

                // Presence sync
                channel.on('presence', { event: 'sync' }, () => {
                    const presenceState = channel!.presenceState<{ isReady: boolean }>()
                    const presenceList = Object.values(presenceState).flat()
                    logger.info('[Presence] sync:', JSON.stringify(presenceList))

                    const readyCount = presenceList.filter((u: any) => u.isReady).length
                    const totalCount = presenceList.length

                    const myId = get().playerId
                    const othersReady = presenceList
                        .filter((u: any) => u.presence_ref !== undefined)
                        .some((u: any) => u.isReady && u.playerId !== myId)
                    set({ partnerReady: othersReady })

                    if (readyCount >= 2 && totalCount >= 2 && get().isPlayer1 && get().room?.status === 'pending') {
                        logger.info('[Presence] 양쪽 준비 완료! 게임 시작')
                        const currentRoom = get().room!
                        const currentQuestions = get().questions
                        const initialTimeLeft = resolveTimeLimit(currentQuestions[0]?.default_time_limit)
                        const payload = {
                            status: 'playing' as const,
                            turn_state: {
                                currentPlayerId: currentRoom.player1_id,
                                timeLeft: initialTimeLeft,
                                isPaused: false
                            }
                        };
                        (supabase as any).from('rooms').update(payload).eq('id', currentRoom.id).then(() => {
                            const updatedRoom = { ...currentRoom, ...payload }
                            trySend('room_update', updatedRoom)
                            set({ room: updatedRoom })
                            logTurnEvent('turn_start', { questionIndex: 0, playerId: currentRoom.player1_id })
                        })
                    }
                })

                // Broadcast listeners (best-effort, may not work on self-hosted)
                channel.on('broadcast', { event: 'stroke' }, (msg) => {
                    logger.info('[수신:broadcast] stroke')
                    if (msg.payload?.stroke) {
                        set((state) => ({ strokes: [...state.strokes, msg.payload.stroke], partnerActiveStroke: null }))
                    }
                })
                channel.on('broadcast', { event: 'active_stroke' }, (msg) => {
                    if (msg.payload?.stroke !== undefined) set({ partnerActiveStroke: msg.payload.stroke })
                })
                channel.on('broadcast', { event: 'erase' }, (msg) => {
                    logger.info('[수신:broadcast] erase')
                    if (msg.payload?.strokeId) {
                        set((state) => ({ strokes: state.strokes.filter((s: any) => s.id !== msg.payload.strokeId) }))
                    }
                })
                channel.on('broadcast', { event: 'clear' }, () => {
                    logger.info('[수신:broadcast] clear')
                    set({ strokes: [], canvasImage: null })
                })
                channel.on('broadcast', { event: 'place_image' }, (msg) => {
                    logger.info('[수신:broadcast] place_image')
                    if (msg.payload?.image) {
                        set({ canvasImage: msg.payload.image })
                    }
                })
                channel.on('broadcast', { event: 'typing' }, (msg) => {
                    if (msg.payload) set({ isAnswering: msg.payload.isAnswering, answerText: msg.payload.text || "" })
                })
                channel.on('broadcast', { event: 'ready' }, (msg) => {
                    if (msg.payload) set({ partnerReady: msg.payload.isReady })
                })
                channel.on('broadcast', { event: 'answer_result' }, (msg) => {
                    logger.info('[수신:broadcast] answer_result')
                    if (msg.payload) set({ lastAnswerResult: msg.payload })
                })
                channel.on('broadcast', { event: 'room_update' }, (msg) => {
                    logger.info('[수신:broadcast] room_update')
                    if (msg.payload) set({ room: msg.payload as RoomRow })
                })

                // Postgres Changes (more reliable on self-hosted)
                channel.on(
                    'postgres' as any,
                    { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
                    (payload: any) => {
                        logger.info('[수신:postgres] rooms UPDATE:', payload.new?.status)
                        set({ room: payload.new as RoomRow })
                    }
                )

                channel.subscribe((status: any, err: any) => {
                    logger.info(`[Realtime] 채널 상태: ${status}`, err || '')
                })

                // ── Start polling as guaranteed fallback ──
                logger.info('[joinRoom] DB 폴링 시작 (2초 간격)')
                startRoomPolling()
                startStrokePolling()

            } catch (err: any) {
                logger.error('[joinRoom] 오류:', err.message)
                set({ error: err.message, isConnected: false })
            }
        },

        leaveRoom: () => {
            logger.info('[leaveRoom] 퇴장')
            stopPolling()
            if (channel) supabase.removeChannel(channel)
            channel = null
            lastStrokeTimestamp = null
            groupTimeLimit = null
            set({ room: null, roomId: null, isConnected: false, strokes: [], partnerActiveStroke: null, isReady: false, partnerReady: false, lastAnswerResult: null, canvasImage: null, roomQuestions: [] })
        },

        toggleReady: () => {
            const isReady = !get().isReady
            logger.info(`[toggleReady] ${isReady}`)
            set({ isReady })

            if (channel) {
                const { playerId } = get()
                channel.track({ isReady, playerId })
                trySend('ready', { isReady })
            }
        },

        addStroke: (stroke: any) => {
            const id = crypto.randomUUID()
            const strokeWithId = { ...stroke, id }
            set((state) => ({ strokes: [...state.strokes, strokeWithId] }))
            const { roomId, playerId } = get()
            logger.info('[addStroke] 획 추가, 포인트:', stroke?.points?.length, 'id:', id)

            trySend('stroke', { stroke: strokeWithId })

            // DB 저장 (polling이 이걸 읽어감)
            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'draw_path',
                    payload: strokeWithId as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[addStroke] DB 저장 실패:', error)
                })
            }
        },

        eraseStroke: (strokeId: string) => {
            logger.info('[eraseStroke] 획 삭제:', strokeId)
            set((state) => ({ strokes: state.strokes.filter((s: any) => s.id !== strokeId) }))
            const { roomId, playerId } = get()

            trySend('erase', { strokeId })

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'erase',
                    payload: { strokeId } as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[eraseStroke] DB 저장 실패:', error)
                })
            }
        },

        updateActiveStroke: (stroke: any | null) => {
            trySend('active_stroke', { stroke })
        },

        clearStrokes: () => {
            logger.info('[clearStrokes] 캔버스 초기화')
            set({ strokes: [], partnerActiveStroke: null, canvasImage: null })
            const { roomId, playerId } = get()

            trySend('clear', {})

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'clear',
                    payload: {}
                } as any).then(({ error }) => {
                    if (error) logger.error('[clearStrokes] DB 저장 실패:', error)
                })
            }
        },

        clearAnswerResult: () => {
            set({ lastAnswerResult: null })
        },

        placeImage: (url: string) => {
            const image: CanvasImage = { url, x: 50, y: 50, width: 300, height: 200, visible: true }
            logger.info('[placeImage] 이미지 배치:', url)
            set({ canvasImage: image })
            const { roomId, playerId } = get()

            trySend('place_image', { image })

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'place_image',
                    payload: image as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[placeImage] DB 저장 실패:', error)
                })
            }
        },

        updateImage: (image: CanvasImage) => {
            set({ canvasImage: image })
            const { roomId, playerId } = get()

            trySend('place_image', { image })

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'place_image',
                    payload: image as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[updateImage] DB 저장 실패:', error)
                })
            }
        },

        startAnswer: () => {
            logger.info('[startAnswer] 정답 입력 시작 — 타이머 일시정지')
            set({ isAnswering: true })

            const { room } = get()
            if (room) {
                const turnState = room.turn_state as any
                const pausedPayload = { turn_state: { ...turnState, isPaused: true } }
                ;(supabase as any).from('rooms').update(pausedPayload).eq('id', room.id).then()
                const updatedRoom = { ...room, ...pausedPayload }
                set({ room: updatedRoom })
                trySend('room_update', updatedRoom)
            }

            trySend('typing', { isAnswering: true, text: get().answerText })
        },

        cancelAnswer: () => {
            logger.info('[cancelAnswer] 정답 입력 취소 — 타이머 재개')
            set({ isAnswering: false, answerText: '' })

            const { room } = get()
            if (room) {
                const turnState = room.turn_state as any
                const resumedPayload = { turn_state: { ...turnState, isPaused: false } }
                ;(supabase as any).from('rooms').update(resumedPayload).eq('id', room.id).then()
                const updatedRoom = { ...room, ...resumedPayload }
                set({ room: updatedRoom })
                trySend('room_update', updatedRoom)
            }

            trySend('typing', { isAnswering: false, text: '' })
        },

        updateAnswerText: (text: string) => {
            set({ answerText: text })
            trySend('typing', { isAnswering: true, text })
        },

        submitAnswer: async () => {
            const { room, questions, answerText } = get()
            if (!room || !answerText.trim()) return

            const currentQuestionIndex = room.current_question_index || 0
            const currentQuestion = questions[currentQuestionIndex]

            if (!currentQuestion) {
                logger.error('[submitAnswer] 현재 문제 없음, index:', currentQuestionIndex)
                set({ isAnswering: false })
                return
            }

            let isCorrect = false
            const correctAnswer = currentQuestion.correct_answer
            if (correctAnswer) {
                if (currentQuestion.question_type === 'multiple_choice') {
                    isCorrect = answerText.trim() === correctAnswer.trim()
                } else {
                    isCorrect = answerText.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
                }
            }

            logger.info(`[submitAnswer] 답: "${answerText}" | 정답: "${correctAnswer}" | 결과: ${isCorrect}`)

            try {
                const { error } = await (supabase as any)
                    .from('room_questions')
                    .update({ submitted_answer: answerText.trim(), is_correct: isCorrect })
                    .eq('room_id', room.id)
                    .eq('question_id', currentQuestion.id)
                if (error) logger.error('[submitAnswer] DB 저장 실패:', error)
            } catch (err) {
                logger.error('[submitAnswer] 예외:', err)
            }

            logTurnEvent('answer_submitted', { questionIndex: currentQuestionIndex, answer: answerText.trim(), isCorrect })

            const currentTurnState = room.turn_state as any

            // Resume timer
            const resumedPayload = { turn_state: { ...currentTurnState, isPaused: false } }
            ;(supabase as any).from('rooms').update(resumedPayload).eq('id', room.id).then()
            const updatedRoom2 = { ...room, ...resumedPayload }
            trySend('room_update', updatedRoom2)
            set({ room: updatedRoom2, isAnswering: false, answerText: '' })

            trySend('typing', { isAnswering: false, text: '' })
            trySend('answer_result', { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex })

            // Also set locally so submitter sees result
            set({ lastAnswerResult: { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex } })

            // Review mode: return to summary; normal mode: advance
            const ts = get().room?.turn_state as any
            if (ts?.isReviewMode) {
                setTimeout(() => { get().backToReview() }, 1500)
            } else {
                setTimeout(() => { get().advanceQuestion() }, 1500)
            }
        },

        advanceQuestion: async () => {
            const { room, questions } = get()
            if (!room) return

            const currentIndex = room.current_question_index || 0
            const nextIndex = currentIndex + 1

            if (nextIndex >= questions.length) {
                logger.info('[advanceQuestion] 모든 문제 완료!')
                const payload = { status: 'completed' as const, current_question_index: currentIndex }
                await (supabase as any).from('rooms').update(payload).eq('id', room.id)
                const updatedRoom = { ...room, ...payload }
                trySend('room_update', updatedRoom)
                set({ room: updatedRoom, strokes: [], canvasImage: null })
                return
            }

            const nextQuestion = questions[nextIndex]
            const nextTimeLeft = resolveTimeLimit(nextQuestion?.default_time_limit)
            logger.info(`[advanceQuestion] 문제 ${nextIndex + 1}/${questions.length}으로 이동`)

            const payload = {
                current_question_index: nextIndex,
                turn_state: { currentPlayerId: room.player1_id, timeLeft: nextTimeLeft, isPaused: false }
            }

            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            logTurnEvent('question_advanced', { fromIndex: currentIndex, toIndex: nextIndex })

            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom, strokes: [], canvasImage: null })
        },

        endTurn: async (reason?: 'manual' | 'timer_expired') => {
            const { room, questions } = get()
            if (!room) return

            const turnState = room.turn_state as any
            const nextPlayerId = room.player1_id === get().playerId ? room.player2_id : room.player1_id
            const currentQ = questions[room.current_question_index]
            const nextTimeLeft = resolveTimeLimit(currentQ?.default_time_limit)

            logger.info(`[endTurn] ${reason || 'manual'} — 다음: ${nextPlayerId}`)

            const payload: Partial<RoomRow> = {
                turn_state: { ...turnState, currentPlayerId: nextPlayerId, timeLeft: nextTimeLeft, isPaused: false }
            }
            await supabase.from('rooms').update(payload as never).eq('id', room.id)

            logTurnEvent(reason === 'timer_expired' ? 'timer_expired' : 'turn_end', {
                questionIndex: room.current_question_index, nextPlayerId
            })

            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom })
        },

        cleanup: () => {
            stopPolling()
        },

        broadcastRoomUpdate: (updatedRoom: RoomRow) => {
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom })
        },

        fetchRoomQuestions: async () => {
            const { roomId } = get()
            if (!roomId) return
            const { data, error } = await (supabase as any)
                .from('room_questions')
                .select('question_id, submitted_answer, is_correct')
                .eq('room_id', roomId)
                .order('created_at', { ascending: true })
            if (error) {
                logger.error('[fetchRoomQuestions] 조회 실패:', error)
                return
            }
            set({ roomQuestions: data || [] })
        },

        goToReviewQuestion: async (questionIndex: number) => {
            const { room, questions } = get()
            if (!room) return
            logger.info(`[goToReviewQuestion] 리뷰 모드 진입, 문제 ${questionIndex + 1}`)
            const question = questions[questionIndex]
            const timeLeft = resolveTimeLimit(question?.default_time_limit)

            const payload = {
                current_question_index: questionIndex,
                turn_state: {
                    currentPlayerId: room.player1_id,
                    timeLeft,
                    isPaused: false,
                    isReviewMode: true,
                    pendingRequest: null,
                }
            }
            await (supabase as any).from('rooms').update(payload).eq('id', room.id)

            // Reset previous answer for this question so it can be re-submitted
            if (question?.id) {
                await (supabase as any).from('room_questions')
                    .update({ submitted_answer: null, is_correct: null })
                    .eq('room_id', room.id)
                    .eq('question_id', question.id)
            }

            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom, isAnswering: false, answerText: '' })
        },

        backToReview: async () => {
            const { room } = get()
            if (!room) return
            logger.info('[backToReview] 리뷰 요약으로 복귀')
            await get().fetchRoomQuestions()
            const payload = {
                turn_state: {
                    ...(room.turn_state as any),
                    isReviewMode: false,
                    pendingRequest: null,
                }
            }
            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom, isAnswering: false, answerText: '' })
        },

        // ── Approval System ──

        requestRetry: async (questionIndex: number) => {
            const { room, playerId } = get()
            if (!room || !playerId) return
            const currentTurnState = room.turn_state as any
            if (currentTurnState?.pendingRequest) return // 중복 방지

            const payload = {
                turn_state: {
                    ...currentTurnState,
                    pendingRequest: {
                        type: 'retry',
                        requestedBy: playerId,
                        questionIndex,
                        requestedAt: new Date().toISOString(),
                    }
                }
            }
            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom })
            logTurnEvent('retry_requested', { questionIndex })
        },

        requestComplete: async () => {
            const { room, playerId } = get()
            if (!room || !playerId) return
            const currentTurnState = room.turn_state as any
            if (currentTurnState?.pendingRequest) return

            const payload = {
                turn_state: {
                    ...currentTurnState,
                    pendingRequest: {
                        type: 'complete',
                        requestedBy: playerId,
                        requestedAt: new Date().toISOString(),
                    }
                }
            }
            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom })
            logTurnEvent('complete_requested', {})
        },

        approveRequest: async () => {
            const { room } = get()
            if (!room) return
            const ts = room.turn_state as any
            const request = ts?.pendingRequest
            if (!request) return

            logTurnEvent('request_approved', { type: request.type, questionIndex: request.questionIndex })

            if (request.type === 'retry') {
                await get().goToReviewQuestion(request.questionIndex)
            } else if (request.type === 'complete') {
                const payload = {
                    turn_state: { ...ts, pendingRequest: null, gameFinished: true }
                }
                await (supabase as any).from('rooms').update(payload).eq('id', room.id)
                const updatedRoom = { ...room, ...payload }
                trySend('room_update', updatedRoom)
                set({ room: updatedRoom })
            }
        },

        rejectRequest: async () => {
            const { room } = get()
            if (!room) return
            const ts = room.turn_state as any
            logTurnEvent('request_rejected', { type: ts?.pendingRequest?.type })

            const payload = {
                turn_state: { ...ts, pendingRequest: null }
            }
            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom })
        },
    }
})

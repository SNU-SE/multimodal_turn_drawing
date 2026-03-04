import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Database } from '@turn-based-drawing/supabase'
import { logger } from "@/lib/logger"

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

    // Gameplay State
    partnerReady: boolean
    isReady: boolean
    timeLeft: number
    strokes: any[]
    partnerActiveStroke: any | null
    answerText: string
    isAnswering: boolean
    lastAnswerResult: { answer: string; isCorrect: boolean; questionIndex: number } | null

    // Actions
    joinRoom: (code: string) => Promise<void>
    leaveRoom: () => void
    toggleReady: () => void
    cleanup: () => void

    // Canvas Actions
    addStroke: (stroke: any) => void
    updateActiveStroke: (stroke: any | null) => void
    clearStrokes: () => void
    clearAnswerResult: () => void

    // Turn Actions
    startAnswer: () => void
    cancelAnswer: () => void
    updateAnswerText: (text: string) => void
    submitAnswer: () => Promise<void>
    advanceQuestion: () => Promise<void>
    endTurn: (reason?: 'manual' | 'timer_expired') => Promise<void>

    broadcastRoomUpdate: (updatedRoom: RoomRow) => void
}

export const useRoomStore = create<RoomState>((set, get) => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollIntervalId: any = null
    let strokePollIntervalId: any = null
    let lastStrokeTimestamp: string | null = null

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
            let shouldClear = false

            for (const log of data) {
                if (log.action_type === 'clear') {
                    shouldClear = true
                    newStrokes.length = 0
                } else if (log.action_type === 'draw_path' && log.payload) {
                    newStrokes.push(log.payload)
                }
                lastStrokeTimestamp = log.timestamp
            }

            if (shouldClear) {
                set((state) => ({ strokes: [...newStrokes] }))
            } else if (newStrokes.length > 0) {
                set((state) => ({ strokes: [...state.strokes, ...newStrokes] }))
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
        questions: [],

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
                logger.info(`[joinRoom] 문제 ${questions.length}개 로드`)

                if (questions.length === 0 && room.group_id) {
                    logger.warn('[joinRoom] room_questions 없음, 그룹 fallback 시도')
                    const { data: groupData } = await (supabase as any)
                        .from('room_groups')
                        .select('question_ids')
                        .eq('id', room.group_id)
                        .single()

                    if (groupData?.question_ids?.length > 0) {
                        const { data: fallbackQData } = await (supabase as any)
                            .from('questions')
                            .select('*')
                            .in('id', groupData.question_ids)
                        questions = fallbackQData || []
                        logger.info(`[joinRoom] fallback 문제 ${questions.length}개 로드`)
                    }
                }

                // ── Load existing strokes from canvas_logs ──
                const { data: existingLogs } = await (supabase as any)
                    .from('canvas_logs')
                    .select('*')
                    .eq('room_id', room.id)
                    .order('timestamp', { ascending: true })

                const existingStrokes: any[] = []
                if (existingLogs) {
                    for (const log of existingLogs) {
                        if (log.action_type === 'clear') {
                            existingStrokes.length = 0
                        } else if (log.action_type === 'draw_path' && log.payload) {
                            existingStrokes.push(log.payload)
                        }
                        lastStrokeTimestamp = log.timestamp
                    }
                    logger.info(`[joinRoom] 기존 획 ${existingStrokes.length}개 로드`)
                }

                set({
                    room, roomId: room.id, playerId: assignedPlayerId,
                    isPlayer1, isConnected: true, questions,
                    strokes: existingStrokes
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
                        const initialTimeLeft = currentQuestions[0]?.default_time_limit || 60
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
                channel.on('broadcast', { event: 'clear' }, () => {
                    logger.info('[수신:broadcast] clear')
                    set({ strokes: [] })
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
            set({ room: null, roomId: null, isConnected: false, strokes: [], partnerActiveStroke: null, isReady: false, partnerReady: false, lastAnswerResult: null })
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
            set((state) => ({ strokes: [...state.strokes, stroke] }))
            const { roomId, playerId } = get()
            logger.info('[addStroke] 획 추가, 포인트:', stroke?.points?.length)

            trySend('stroke', { stroke })

            // DB 저장 (polling이 이걸 읽어감)
            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'draw_path',
                    payload: stroke as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[addStroke] DB 저장 실패:', error)
                })
            }
        },

        updateActiveStroke: (stroke: any | null) => {
            trySend('active_stroke', { stroke })
        },

        clearStrokes: () => {
            logger.info('[clearStrokes] 캔버스 초기화')
            set({ strokes: [], partnerActiveStroke: null })
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

            // Resume timer
            const turnState = room.turn_state as any
            const resumedPayload = { turn_state: { ...turnState, isPaused: false } }
            ;(supabase as any).from('rooms').update(resumedPayload).eq('id', room.id).then()
            const updatedRoom2 = { ...room, ...resumedPayload }
            trySend('room_update', updatedRoom2)
            set({ room: updatedRoom2, isAnswering: false, answerText: '' })

            trySend('typing', { isAnswering: false, text: '' })
            trySend('answer_result', { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex })

            // Also set locally so submitter sees result
            set({ lastAnswerResult: { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex } })

            setTimeout(() => { get().advanceQuestion() }, 1500)
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
                set({ room: updatedRoom, strokes: [] })
                return
            }

            const nextQuestion = questions[nextIndex]
            const nextTimeLeft = nextQuestion?.default_time_limit || 60
            logger.info(`[advanceQuestion] 문제 ${nextIndex + 1}/${questions.length}으로 이동`)

            const payload = {
                current_question_index: nextIndex,
                turn_state: { currentPlayerId: room.player1_id, timeLeft: nextTimeLeft, isPaused: false }
            }

            await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            logTurnEvent('question_advanced', { fromIndex: currentIndex, toIndex: nextIndex })

            const updatedRoom = { ...room, ...payload }
            trySend('room_update', updatedRoom)
            set({ room: updatedRoom, strokes: [] })
        },

        endTurn: async (reason?: 'manual' | 'timer_expired') => {
            const { room, questions } = get()
            if (!room) return

            const turnState = room.turn_state as any
            const nextPlayerId = room.player1_id === get().playerId ? room.player2_id : room.player1_id
            const currentQ = questions[room.current_question_index]
            const nextTimeLeft = currentQ?.default_time_limit || 60

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
        }
    }
})

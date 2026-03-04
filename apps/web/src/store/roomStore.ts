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

    // Added to trigger room updates to partner
    broadcastRoomUpdate: (updatedRoom: RoomRow) => void
}

export const useRoomStore = create<RoomState>((set, get) => {
    let intervalId: any = null
    let channel: ReturnType<typeof supabase.channel> | null = null
    let isChannelReady = false

    const safeSend = (event: string, payload: any) => {
        if (!channel) {
            logger.warn(`[safeSend] 채널 없음 — ${event} 전송 실패`)
            return
        }
        if (!isChannelReady) {
            logger.warn(`[safeSend] 채널 미연결 — ${event} 전송 대기 불가, 무시됨`)
            return
        }
        logger.info(`[safeSend] 전송: ${event}`, typeof payload === 'object' ? JSON.stringify(payload).slice(0, 200) : payload)
        channel.send({
            type: 'broadcast',
            event,
            payload
        }).then((status: any) => {
            logger.debug(`[safeSend] ${event} 전송 결과:`, status)
        }).catch((err: any) => {
            logger.error(`[safeSend] ${event} 전송 오류:`, err)
        })
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
            else logger.debug(`[logTurnEvent] ${eventType} DB 저장 완료`)
        })
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

                if (qError) {
                    logger.error('[joinRoom] room_questions 조회 실패:', qError)
                }

                let questions = qData?.map((q: any) => q.questions).filter(Boolean) || []
                logger.info(`[joinRoom] 문제 ${questions.length}개 로드`)

                // Fallback
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

                set({ room, roomId: room.id, playerId: assignedPlayerId, isPlayer1, isConnected: true, questions })

                // ── Realtime 채널 구독 ──
                logger.info('[joinRoom] Realtime 채널 생성:', `room:${room.id}`)
                channel = supabase.channel(`room:${room.id}`, {
                    config: { presence: { key: assignedPlayerId } }
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
                            safeSend('room_update', updatedRoom)
                            set({ room: updatedRoom })
                            logTurnEvent('turn_start', { questionIndex: 0, playerId: currentRoom.player1_id })
                        })
                    }
                })

                // ── Broadcast 수신 ──
                channel.on('broadcast', { event: 'active_stroke' }, (msg) => {
                    if (msg.payload?.stroke !== undefined) {
                        set({ partnerActiveStroke: msg.payload.stroke })
                    }
                })

                channel.on('broadcast', { event: 'stroke' }, (msg) => {
                    logger.info('[수신] stroke — points:', msg.payload?.stroke?.points?.length)
                    if (msg.payload?.stroke) {
                        set((state) => ({
                            strokes: [...state.strokes, msg.payload.stroke],
                            partnerActiveStroke: null
                        }))
                    }
                })

                channel.on('broadcast', { event: 'clear' }, () => {
                    logger.info('[수신] clear canvas')
                    set({ strokes: [] })
                })

                channel.on('broadcast', { event: 'typing' }, (msg) => {
                    logger.debug('[수신] typing:', msg.payload)
                    if (msg.payload) {
                        set({
                            isAnswering: msg.payload.isAnswering,
                            answerText: msg.payload.text || ""
                        })
                    }
                })

                channel.on('broadcast', { event: 'ready' }, (msg) => {
                    logger.info('[수신] ready:', msg.payload?.isReady)
                    if (msg.payload) {
                        set({ partnerReady: msg.payload.isReady })
                    }
                })

                channel.on('broadcast', { event: 'answer_result' }, (msg) => {
                    logger.info('[수신] answer_result:', msg.payload)
                    if (msg.payload) {
                        set({ lastAnswerResult: msg.payload })
                    }
                })

                channel.on('broadcast', { event: 'room_update' }, (msg) => {
                    logger.info('[수신] room_update:', JSON.stringify(msg.payload).slice(0, 300))
                    if (msg.payload) {
                        set({ room: msg.payload as RoomRow })
                    }
                })

                // Postgres Changes (if enabled)
                channel.on(
                    'postgres' as any,
                    { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
                    (payload: any) => {
                        logger.info('[수신] Postgres rooms UPDATE:', payload.new?.status)
                        const updatedRoom = payload.new as RoomRow
                        set({ room: updatedRoom })
                    }
                )

                // ── Subscribe & 상태 확인 ──
                channel.subscribe((status, err) => {
                    logger.info(`[Realtime] 채널 상태: ${status}`, err ? `오류: ${err}` : '')
                    if (status === 'SUBSCRIBED') {
                        isChannelReady = true
                        logger.info('[Realtime] 채널 연결 완료! broadcast 전송 가능')
                    } else if (status === 'CHANNEL_ERROR') {
                        isChannelReady = false
                        logger.error('[Realtime] 채널 오류 발생')
                    } else if (status === 'CLOSED') {
                        isChannelReady = false
                        logger.warn('[Realtime] 채널 닫힘')
                    }
                })
            } catch (err: any) {
                logger.error('[joinRoom] 오류:', err.message)
                set({ error: err.message, isConnected: false })
            }
        },

        leaveRoom: () => {
            logger.info('[leaveRoom] 퇴장')
            isChannelReady = false
            if (channel) supabase.removeChannel(channel)
            channel = null
            set({ room: null, roomId: null, isConnected: false, strokes: [], partnerActiveStroke: null, isReady: false, partnerReady: false, lastAnswerResult: null })
            get().cleanup()
        },

        toggleReady: () => {
            const isReady = !get().isReady
            logger.info(`[toggleReady] ${isReady}`)
            set({ isReady })

            if (channel && isChannelReady) {
                const { playerId } = get()
                channel.track({ isReady, playerId })
                safeSend('ready', { isReady })
            } else {
                logger.warn('[toggleReady] 채널 미연결, presence track 불가')
            }
        },

        addStroke: (stroke: any) => {
            set((state) => ({ strokes: [...state.strokes, stroke] }))

            const { roomId, playerId } = get()
            logger.debug('[addStroke] 획 추가, 포인트 수:', stroke?.points?.length)

            safeSend('stroke', { stroke })

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'draw_path',
                    payload: stroke as any
                } as any).then(({ error }) => {
                    if (error) logger.error('[addStroke] canvas_logs 저장 실패:', error)
                })
            }
        },

        updateActiveStroke: (stroke: any | null) => {
            safeSend('active_stroke', { stroke })
        },

        clearStrokes: () => {
            logger.info('[clearStrokes] 캔버스 초기화')
            set({ strokes: [], partnerActiveStroke: null })

            const { roomId, playerId } = get()
            safeSend('clear', {})

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'clear',
                    payload: {}
                } as any).then(({ error }) => {
                    if (error) logger.error('[clearStrokes] canvas_logs 저장 실패:', error)
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
                ;(supabase as any).from('rooms').update(pausedPayload).eq('id', room.id).then(({ error }: any) => {
                    if (error) logger.error('[startAnswer] DB 업데이트 실패:', error)
                })
                const updatedRoom = { ...room, ...pausedPayload }
                set({ room: updatedRoom })
                safeSend('room_update', updatedRoom)
            }

            safeSend('typing', { isAnswering: true, text: get().answerText })
        },

        cancelAnswer: () => {
            logger.info('[cancelAnswer] 정답 입력 취소 — 타이머 재개')
            set({ isAnswering: false, answerText: '' })

            const { room } = get()
            if (room) {
                const turnState = room.turn_state as any
                const resumedPayload = { turn_state: { ...turnState, isPaused: false } }
                ;(supabase as any).from('rooms').update(resumedPayload).eq('id', room.id).then(({ error }: any) => {
                    if (error) logger.error('[cancelAnswer] DB 업데이트 실패:', error)
                })
                const updatedRoom = { ...room, ...resumedPayload }
                set({ room: updatedRoom })
                safeSend('room_update', updatedRoom)
            }

            safeSend('typing', { isAnswering: false, text: '' })
        },

        updateAnswerText: (text: string) => {
            set({ answerText: text })
            safeSend('typing', { isAnswering: true, text })
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
                    .update({
                        submitted_answer: answerText.trim(),
                        is_correct: isCorrect
                    })
                    .eq('room_id', room.id)
                    .eq('question_id', currentQuestion.id)
                if (error) logger.error('[submitAnswer] DB 저장 실패:', error)
                else logger.info('[submitAnswer] DB 저장 완료')
            } catch (err) {
                logger.error('[submitAnswer] 예외:', err)
            }

            logTurnEvent('answer_submitted', { questionIndex: currentQuestionIndex, answer: answerText.trim(), isCorrect })

            // Resume timer
            const turnState = room.turn_state as any
            const resumedPayload = { turn_state: { ...turnState, isPaused: false } }
            ;(supabase as any).from('rooms').update(resumedPayload).eq('id', room.id).then(({ error }: any) => {
                if (error) logger.error('[submitAnswer] 타이머 재개 실패:', error)
            })
            const updatedRoom2 = { ...room, ...resumedPayload }
            safeSend('room_update', updatedRoom2)
            set({ room: updatedRoom2, isAnswering: false, answerText: '' })

            safeSend('typing', { isAnswering: false, text: '' })
            safeSend('answer_result', { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex })

            setTimeout(() => {
                get().advanceQuestion()
            }, 1500)
        },

        advanceQuestion: async () => {
            const { room, questions } = get()
            if (!room) return

            const currentIndex = room.current_question_index || 0
            const nextIndex = currentIndex + 1

            if (nextIndex >= questions.length) {
                logger.info('[advanceQuestion] 모든 문제 완료!')
                const payload = { status: 'completed' as const, current_question_index: currentIndex }
                const { error } = await (supabase as any).from('rooms').update(payload).eq('id', room.id)
                if (error) logger.error('[advanceQuestion] 완료 업데이트 실패:', error)

                const updatedRoom = { ...room, ...payload }
                safeSend('room_update', updatedRoom)
                set({ room: updatedRoom, strokes: [] })
                return
            }

            const nextQuestion = questions[nextIndex]
            const nextTimeLeft = nextQuestion?.default_time_limit || 60

            logger.info(`[advanceQuestion] 문제 ${nextIndex + 1}/${questions.length}으로 이동`)

            const payload = {
                current_question_index: nextIndex,
                turn_state: {
                    currentPlayerId: room.player1_id,
                    timeLeft: nextTimeLeft,
                    isPaused: false
                }
            }

            const { error } = await (supabase as any).from('rooms').update(payload).eq('id', room.id)
            if (error) logger.error('[advanceQuestion] DB 업데이트 실패:', error)

            logTurnEvent('question_advanced', { fromIndex: currentIndex, toIndex: nextIndex })

            const updatedRoom = { ...room, ...payload }
            safeSend('room_update', updatedRoom)
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
                turn_state: {
                    ...turnState,
                    currentPlayerId: nextPlayerId,
                    timeLeft: nextTimeLeft,
                    isPaused: false
                }
            }
            const { error } = await supabase.from('rooms').update(payload as never).eq('id', room.id)
            if (error) logger.error('[endTurn] DB 업데이트 실패:', error)

            logTurnEvent(reason === 'timer_expired' ? 'timer_expired' : 'turn_end', {
                questionIndex: room.current_question_index,
                nextPlayerId
            })

            const updatedRoom = { ...room, ...payload }
            safeSend('room_update', updatedRoom)
            set({ room: updatedRoom })
        },

        cleanup: () => {
            if (intervalId) clearInterval(intervalId)
        },

        broadcastRoomUpdate: (updatedRoom: RoomRow) => {
            safeSend('room_update', updatedRoom)
            set({ room: updatedRoom })
        }
    }
})

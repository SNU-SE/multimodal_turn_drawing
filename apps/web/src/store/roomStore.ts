import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { Database } from '@turn-based-drawing/supabase'
import { logger } from "@/lib/logger"

type RoomRow = Database['public']['Tables']['rooms']['Row']

interface RoomState {
    // Session & Connection
    room: RoomRow | null
    roomId: string | null
    playerId: string | null // current user's assigned ID (mocked initially)
    isPlayer1: boolean
    isConnected: boolean
    error: string | null
    questions: any[]

    // Gameplay State
    partnerReady: boolean
    isReady: boolean
    timeLeft: number
    strokes: any[]
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
    clearStrokes: () => void
    clearAnswerResult: () => void

    // Turn Actions
    startAnswer: () => void
    cancelAnswer: () => void
    updateAnswerText: (text: string) => void
    submitAnswer: () => Promise<void>
    advanceQuestion: () => Promise<void>
    endTurn: () => Promise<void>

    // Added to trigger room updates to partner
    broadcastRoomUpdate: (updatedRoom: RoomRow) => void
}

export const useRoomStore = create<RoomState>((set, get) => {
    let intervalId: any = null
    let channel: ReturnType<typeof supabase.channel> | null = null

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
        answerText: "",
        isAnswering: false,
        lastAnswerResult: null,
        questions: [],

        joinRoom: async (code: string) => {
            logger.info('Attempting to join room with invite code:', code)
            set({ error: null })
            try {
                // Find room by either player1 or player2 invite code
                const { data, error } = await supabase
                    .from('rooms')
                    .select('*')
                    .or(`player1_invite_code.eq.${code},player2_invite_code.eq.${code}`)
                    .single()

                const room = data as RoomRow | null

                if (error || !room) {
                    throw new Error('올바르지 않은 접속 코드입니다.')
                }

                const isPlayer1 = room.player1_invite_code === code
                const assignedPlayerId = isPlayer1 ? room.player1_id : room.player2_id

                if (!assignedPlayerId) {
                    throw new Error('이 자리에 할당된 참가자 정보가 없습니다.')
                }

                // Fetch questions mapped to this room
                const { data: qData } = await (supabase as any)
                    .from('room_questions')
                    .select('*, questions(*)')
                    .eq('room_id', room.id)

                const questions = qData?.map((q: any) => q.questions).filter(Boolean) || []

                set({ room, roomId: room.id, playerId: assignedPlayerId, isPlayer1, isConnected: true, questions })

                // 1. Subscribe to DB changes for this room
                // IMPORTANT: enable Presence for reliable ready-state tracking
                channel = supabase.channel(`room:${room.id}`, {
                    config: { presence: { key: assignedPlayerId } }
                })

                // Presence sync — detect when BOTH players are ready
                channel.on('presence', { event: 'sync' }, () => {
                    const presenceState = channel!.presenceState<{ isReady: boolean }>()
                    const presenceList = Object.values(presenceState).flat()
                    logger.info('Presence sync:', presenceList)

                    const readyCount = presenceList.filter((u: any) => u.isReady).length
                    const totalCount = presenceList.length

                    // Update partner ready indicator
                    const myId = get().playerId
                    const othersReady = presenceList
                        .filter((u: any) => u.presence_ref !== undefined)
                        .some((u: any) => u.isReady && u.playerId !== myId)
                    set({ partnerReady: othersReady })

                    // If BOTH players in the room are ready → P1 starts the game
                    if (readyCount >= 2 && totalCount >= 2 && get().isPlayer1 && get().room?.status === 'pending') {
                        logger.info('Presence: both players ready! Starting room...')
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
                            channel!.send({ type: 'broadcast', event: 'room_update', payload: updatedRoom })
                            set({ room: updatedRoom })
                        })
                    }
                })

                // Broadcast for fast stroke syncing
                channel.on('broadcast', { event: 'stroke' }, (payload) => {
                    logger.debug('Received broadcast: stroke', payload.payload?.stroke?.points?.length, 'points')
                    if (payload.payload?.stroke) {
                        set((state) => ({ strokes: [...state.strokes, payload.payload.stroke] }))
                    }
                })

                channel.on('broadcast', { event: 'clear' }, () => {
                    logger.debug('Received broadcast: clear canvas')
                    set({ strokes: [] })
                })

                channel.on('broadcast', { event: 'typing' }, (payload) => {
                    logger.debug('Received broadcast: typing', payload.payload)
                    if (payload.payload) {
                        set({
                            isAnswering: payload.payload.isAnswering,
                            answerText: payload.payload.text || ""
                        })
                    }
                })

                // Broadcast for readiness (kept as fallback)
                channel.on('broadcast', { event: 'ready' }, (payload) => {
                    logger.info(`Partner readiness broadcast:`, payload.payload?.isReady)
                    if (payload.payload) {
                        set({ partnerReady: payload.payload.isReady })
                    }
                })

                // Listen for answer results (both submitter and partner get feedback)
                channel.on('broadcast', { event: 'answer_result' }, (payload) => {
                    logger.info('Answer result received:', payload.payload)
                    if (payload.payload) {
                        set({ lastAnswerResult: payload.payload })
                    }
                })

                // Broadcast for room state updates (fallback for missing postgres realtime)
                channel.on('broadcast', { event: 'room_update' }, (payload) => {
                    logger.info(`Partner updated room state:`, payload.payload)
                    if (payload.payload) {
                        set({ room: payload.payload as RoomRow })
                    }
                })

                // Listen to Postgres changes (if enabled)
                channel.on(
                    'postgres' as any,
                    { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
                    (payload: any) => {
                        logger.info('Postgres Room Update received:', payload.new)
                        const updatedRoom = payload.new as RoomRow
                        set({ room: updatedRoom })
                    }
                )

                channel.subscribe((status) => {
                    logger.info(`Realtime Channel status: ${status}`)
                })
            } catch (err: any) {
                logger.error('Error joining room:', err.message)
                set({ error: err.message, isConnected: false })
            }
        },

        leaveRoom: () => {
            if (channel) supabase.removeChannel(channel)
            set({ room: null, roomId: null, isConnected: false, strokes: [], isReady: false, partnerReady: false, lastAnswerResult: null })
            get().cleanup()
        },

        toggleReady: () => {
            const isReady = !get().isReady
            logger.info(`Toggling local ready state to: ${isReady}`)
            set({ isReady })

            // Use Presence for reliable state sharing
            if (channel) {
                const { playerId } = get()
                channel.track({ isReady, playerId })
                // Also keep the broadcast as fallback for older clients
                channel.send({
                    type: 'broadcast',
                    event: 'ready',
                    payload: { isReady }
                })
            }
        },

        addStroke: (stroke: any) => {
            set((state) => ({ strokes: [...state.strokes, stroke] }))

            const { roomId, playerId } = get()

            // Broadcast to partner
            if (channel) {
                channel.send({
                    type: 'broadcast',
                    event: 'stroke',
                    payload: { stroke }
                })
            }

            // Save to Supabase (fire and forget)
            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'draw_path',
                    payload: stroke as any
                } as any).then()
            }
        },

        clearStrokes: () => {
            set({ strokes: [] })

            const { roomId, playerId } = get()

            if (channel) {
                channel.send({
                    type: 'broadcast',
                    event: 'clear',
                    payload: {}
                })
            }

            if (roomId && playerId) {
                supabase.from('canvas_logs').insert({
                    room_id: roomId,
                    player_id: playerId,
                    action_type: 'clear',
                    payload: {}
                } as any).then()
            }
        },

        clearAnswerResult: () => {
            set({ lastAnswerResult: null })
        },

        startAnswer: () => {
            set({ isAnswering: true })
            if (channel) {
                channel.send({ type: 'broadcast', event: 'typing', payload: { isAnswering: true, text: get().answerText } })
            }
        },

        cancelAnswer: () => {
            set({ isAnswering: false, answerText: '' })
            if (channel) {
                channel.send({ type: 'broadcast', event: 'typing', payload: { isAnswering: false, text: '' } })
            }
        },

        updateAnswerText: (text: string) => {
            set({ answerText: text })
            if (channel) {
                channel.send({ type: 'broadcast', event: 'typing', payload: { isAnswering: true, text } })
            }
        },

        submitAnswer: async () => {
            const { room, questions, answerText } = get()
            if (!room || !answerText.trim()) return

            const currentQuestionIndex = room.current_question_index || 0
            const currentQuestion = questions[currentQuestionIndex]

            if (!currentQuestion) {
                logger.error('No current question found at index', currentQuestionIndex)
                set({ isAnswering: false })
                return
            }

            // Auto-grade: compare submitted answer with correct_answer
            let isCorrect = false
            const correctAnswer = currentQuestion.correct_answer
            if (correctAnswer) {
                if (currentQuestion.question_type === 'multiple_choice') {
                    // For MC, answers are stored as comma-separated indices like "1,3"
                    isCorrect = answerText.trim() === correctAnswer.trim()
                } else {
                    // For essay, case-insensitive match
                    isCorrect = answerText.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
                }
            }

            logger.info(`Answer submitted: "${answerText}" | Correct: "${correctAnswer}" | Match: ${isCorrect}`)

            // Save answer to room_questions table
            try {
                await (supabase as any)
                    .from('room_questions')
                    .update({
                        submitted_answer: answerText.trim(),
                        is_correct: isCorrect
                    })
                    .eq('room_id', room.id)
                    .eq('question_id', currentQuestion.id)
            } catch (err) {
                logger.error('Failed to save answer:', err)
            }

            set({ isAnswering: false, answerText: '' })

            // Broadcast typing stopped
            if (channel) {
                channel.send({ type: 'broadcast', event: 'typing', payload: { isAnswering: false, text: '' } })
                // Broadcast answer result to partner
                channel.send({
                    type: 'broadcast',
                    event: 'answer_result',
                    payload: { answer: answerText.trim(), isCorrect, questionIndex: currentQuestionIndex }
                })
            }

            // Advance to next question after a short delay
            setTimeout(() => {
                get().advanceQuestion()
            }, 1500)
        },

        advanceQuestion: async () => {
            const { room, questions } = get()
            if (!room) return

            const currentIndex = room.current_question_index || 0
            const nextIndex = currentIndex + 1

            // C3: Check if all questions are done
            if (nextIndex >= questions.length) {
                logger.info('All questions completed! Finishing game...')
                const payload = { status: 'completed' as const, current_question_index: currentIndex }
                await (supabase as any).from('rooms').update(payload).eq('id', room.id)

                const updatedRoom = { ...room, ...payload }
                if (channel) {
                    channel.send({ type: 'broadcast', event: 'room_update', payload: updatedRoom })
                }
                set({ room: updatedRoom, strokes: [] })
                return
            }

            // C2: Advance to next question
            const nextQuestion = questions[nextIndex]
            const nextTimeLeft = nextQuestion?.default_time_limit || 60

            logger.info(`Advancing to question ${nextIndex + 1}/${questions.length}`)

            const payload = {
                current_question_index: nextIndex,
                turn_state: {
                    currentPlayerId: room.player1_id, // Reset turn to Player 1
                    timeLeft: nextTimeLeft,
                    isPaused: false
                }
            }

            await (supabase as any).from('rooms').update(payload).eq('id', room.id)

            const updatedRoom = { ...room, ...payload }
            if (channel) {
                channel.send({ type: 'broadcast', event: 'room_update', payload: updatedRoom })
            }
            set({ room: updatedRoom, strokes: [] }) // Clear canvas for new question
        },

        endTurn: async () => {
            const { room, questions } = get()
            if (!room) return

            const turnState = room.turn_state as any
            const nextPlayerId = room.player1_id === get().playerId ? room.player2_id : room.player1_id

            // Identify current question for time limit
            const currentQ = questions[room.current_question_index]
            const nextTimeLeft = currentQ?.default_time_limit || 60

            // Only update DB if we have both players or at least we pretend to flip it
            const payload: Partial<RoomRow> = {
                turn_state: {
                    ...turnState,
                    currentPlayerId: nextPlayerId,
                    timeLeft: nextTimeLeft,
                    isPaused: false
                }
            }
            await supabase.from('rooms').update(payload as never).eq('id', room.id)

            // Broadcast room update instantly
            if (channel) {
                const updatedRoom = { ...room, ...payload }
                channel.send({
                    type: 'broadcast',
                    event: 'room_update',
                    payload: updatedRoom
                })
                set({ room: updatedRoom })
            }
        },

        cleanup: () => {
            if (intervalId) clearInterval(intervalId)
        },

        broadcastRoomUpdate: (updatedRoom: RoomRow) => {
            if (channel) {
                channel.send({
                    type: 'broadcast',
                    event: 'room_update',
                    payload: updatedRoom
                })
                set({ room: updatedRoom })
            }
        }
    }
})

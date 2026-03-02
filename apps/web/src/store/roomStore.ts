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

    // Gameplay State
    partnerReady: boolean
    isReady: boolean
    timeLeft: number
    strokes: any[]
    answerText: string
    isAnswering: boolean

    // Actions
    joinRoom: (code: string) => Promise<void>
    leaveRoom: () => void
    toggleReady: () => void
    cleanup: () => void

    // Canvas Actions
    addStroke: (stroke: any) => void
    clearStrokes: () => void

    // Turn Actions
    startAnswer: () => void
    cancelAnswer: () => void
    updateAnswerText: (text: string) => void
    submitAnswer: () => Promise<void>
    endTurn: () => Promise<void>
}

// Generate a pseudo UUID for anonymous testing for now
const generateMockUUID = () => crypto.randomUUID()

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

        joinRoom: async (code: string) => {
            logger.info('Attempting to join room with code:', code)
            set({ error: null })
            try {
                const { data, error } = await supabase
                    .from('rooms')
                    .select('*')
                    .eq('code', code)
                    .single()

                const room = data as RoomRow | null

                if (error || !room) {
                    throw new Error('방을 찾을 수 없습니다.')
                }

                // Assign mock Player ID if needed or detect player 1/2
                // For actual app, users table assignment should happen. Here we just mock local session
                let localPlayerId = localStorage.getItem('local_player_id')
                if (!localPlayerId) {
                    localPlayerId = generateMockUUID()
                    localStorage.setItem('local_player_id', localPlayerId)

                    // Create user in DB to satisfy canvas_logs player_id FK constraint
                    await supabase.from('users').insert({
                        id: localPlayerId,
                        admin_alias: `Guest_${localPlayerId.substring(0, 4)}`
                    } as any)
                }

                const isPlayer1 = room.player1_id === localPlayerId || (!room.player1_id)

                // For real app we'd UPDATE the room to set player1/2_id
                // We will skip that UPDATE to not block if RLS is strict, just proceed with local assumptions

                set({ room, roomId: room.id, playerId: localPlayerId, isPlayer1, isConnected: true })

                // 1. Subscribe to DB changes for this room
                channel = supabase.channel(`room:${room.id}`)

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

                // Broadcast for readiness
                channel.on('broadcast', { event: 'ready' }, (payload) => {
                    logger.info(`Partner readiness status changed:`, payload.payload?.isReady)
                    if (payload.payload) {
                        set({ partnerReady: payload.payload.isReady })
                    }
                })

                // Listen to Postgres changes
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
            set({ room: null, roomId: null, isConnected: false, strokes: [], isReady: false, partnerReady: false })
            get().cleanup()
        },

        toggleReady: () => {
            const isReady = !get().isReady
            logger.info(`Toggling local ready state to: ${isReady}`)
            set({ isReady })

            if (channel) {
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
            // Logic to insert into room_questions
            set({ isAnswering: false })
            // move to next question logic
        },

        endTurn: async () => {
            const { room } = get()
            if (!room) return

            const turnState = room.turn_state as any
            const nextPlayerId = room.player1_id === get().playerId ? room.player2_id : room.player1_id

            // Only update DB if we have both players or at least we pretend to flip it
            const payload: Partial<RoomRow> = {
                turn_state: {
                    ...turnState,
                    currentPlayerId: nextPlayerId,
                    timeLeft: 60,
                    isPaused: false
                }
            }
            await supabase.from('rooms').update(payload as never).eq('id', room.id)
        },

        cleanup: () => {
            if (intervalId) clearInterval(intervalId)
        }
    }
})

import { useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useRoomStore } from "@/store/roomStore"
import LobbyWait from "./LobbyWait"
import MainGame from "./MainGame"
import { Loader2 } from "lucide-react"
import { logger } from "@/lib/logger"

export default function RoomWrapper() {
    const { code } = useParams()
    const navigate = useNavigate()

    const { room, isConnected, error, joinRoom, leaveRoom } = useRoomStore()

    useEffect(() => {
        if (code) {
            logger.info('User attempting to join room code:', code)
            joinRoom(code)
        }
        return () => {
            leaveRoom()
        }
    }, [code, joinRoom, leaveRoom])

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background">
                <h2 className="text-xl font-bold text-destructive mb-4">입장 실패</h2>
                <p className="text-muted-foreground mb-6">{error}</p>
                <button
                    onClick={() => navigate('/')}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium"
                >
                    돌아가기
                </button>
            </div>
        )
    }

    if (!isConnected || !room) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-muted-foreground">방 정보 로드 중...</p>
            </div>
        )
    }

    // Route depending on room status
    if (room.status === 'playing') {
        logger.debug(`Room ${room.id} is playing. Routing to MainGame.`)
        return <MainGame />
    }

    logger.debug(`Room ${room.id} is pending/completed. Routing to LobbyWait.`)
    return <LobbyWait />
}

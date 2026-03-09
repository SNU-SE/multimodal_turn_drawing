import { useRoomStore } from "@/store/roomStore"
import { useMediaStore } from "@/store/mediaStore"
import { VideoTile } from "@/components/media/VideoTile"
import { Info, Eraser, Mic, MicOff, Camera, CameraOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FreehandCanvas } from "@/components/canvas/FreehandCanvas"
import { logger } from "@/lib/logger"
import { useEffect, useState } from "react"

export default function LobbyWait() {
    const { room, isPlayer1, partnerReady, isReady, toggleReady, strokes, addStroke, clearStrokes } = useRoomStore()
    const { localCameraTrack, localMicTrack, isMicMuted, isCameraOff, initLocalMedia, toggleMic, toggleCamera } = useMediaStore()
    const [mediaError, setMediaError] = useState<string | null>(null)

    useEffect(() => {
        logger.info(`Lobby Wait. Room: ${room?.id}, isPlayer1: ${isPlayer1}, isReady: ${isReady}, partnerReady: ${partnerReady}`)
    }, [room?.id, isPlayer1, isReady, partnerReady])

    const playerColor = isPlayer1 ? "#F45B69" : "#5386E4"
    const playerRoleName = isPlayer1 ? "플레이어 1" : "플레이어 2"

    const handleReadyClick = async () => {
        // If toggling TO ready and media not yet initialized, init media first
        if (!isReady && !localCameraTrack && !localMicTrack) {
            try {
                setMediaError(null)
                await initLocalMedia()
            } catch (err) {
                const msg = err instanceof Error ? err.message : "미디어 초기화 실패"
                logger.error(`Media init failed: ${msg}`)
                setMediaError(msg)
                // Non-blocking: proceed with ready even if media fails
            }
        }
        toggleReady()
    }

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Lobby Header */}
            <header className="h-16 flex items-center justify-between px-6 border-b shrink-0 bg-card">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-mono font-bold text-lg tracking-wider">
                        {room?.code}
                    </div>
                    <div>
                        <h1 className="font-bold text-lg">대기실</h1>
                        <p className="text-sm text-muted-foreground">두 플레이어가 준비가 다 될 때까지 캔버스를 테스트하세요.</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${partnerReady ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
                            <span className={`relative inline-flex rounded-full h-3 w-3 ${partnerReady ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                        </span>
                        <span className="text-sm font-medium">상대방: {partnerReady ? "준비 완료" : "대기중"}</span>
                    </div>
                    <Button
                        onClick={handleReadyClick}
                        variant={isReady ? "outline" : "default"}
                        className={!isReady ? "bg-primary hover:bg-primary/90 min-w-[120px]" : "min-w-[120px]"}
                    >
                        {isReady ? "준비 취소" : "준비 완료"}
                    </Button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden p-6 flex gap-6">

                {/* Left Side: Camera Preview + Info */}
                <aside className="w-80 flex flex-col gap-4 shrink-0">
                    {/* Camera Preview */}
                    <Card>
                        <CardContent className="pt-4 pb-4 flex flex-col gap-3">
                            <VideoTile
                                track={localCameraTrack}
                                label={playerRoleName}
                                isMirrored
                                showMuteButton
                                isMuted={isMicMuted}
                                onToggleMute={() => toggleMic()}
                            />

                            {/* Media status indicators */}
                            <div className="flex flex-col gap-1.5 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block w-2 h-2 rounded-full ${isCameraOff ? 'bg-red-500' : 'bg-green-500'}`} />
                                    <span className="text-muted-foreground">
                                        {isCameraOff ? "카메라 꺼짐" : "카메라 켜짐"}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block w-2 h-2 rounded-full ${isMicMuted ? 'bg-red-500' : 'bg-green-500'}`} />
                                    <span className="text-muted-foreground">
                                        {isMicMuted ? "마이크 꺼짐" : "마이크 켜짐"}
                                    </span>
                                </div>
                            </div>

                            {/* Mic/Camera toggle buttons */}
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleMic()}
                                    disabled={!localMicTrack}
                                    className="flex-1 gap-1.5"
                                >
                                    {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                    {isMicMuted ? "음소거 해제" : "음소거"}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleCamera()}
                                    disabled={!localCameraTrack}
                                    className="flex-1 gap-1.5"
                                >
                                    {isCameraOff ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                                    {isCameraOff ? "카메라 켜기" : "카메라 끄기"}
                                </Button>
                            </div>

                            {/* Media error message */}
                            {mediaError && (
                                <p className="text-xs text-destructive">
                                    미디어 오류: {mediaError}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Player info card */}
                    <Card>
                        <CardContent className="pt-6 flex flex-col items-center text-center gap-4">
                            <div
                                className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-inner"
                                style={{ backgroundColor: playerColor }}
                            >
                                {isPlayer1 ? "P1" : "P2"}
                            </div>
                            <div>
                                <h3 className="font-bold text-lg">{playerRoleName}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    테스트를 위해 부여된 색상입니다. 본 게임 돌입 시 색상과 굵기를 선택할 수 있습니다.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="pt-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                                <p className="text-sm">
                                    두 명의 참가자가 모두 접속하고 <strong>준비 완료</strong>를 누르면 첫 번째 문제가 공개되고 타이머가 시작됩니다.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </aside>

                {/* Right Side: Canvas Test Area */}
                <div className="flex-1 flex flex-col bg-card border rounded-xl overflow-hidden shadow-sm relative">
                    <div className="absolute top-4 right-4 z-10">
                        <Button variant="secondary" size="sm" onClick={() => clearStrokes()} className="gap-2 shadow-sm border border-border">
                            <Eraser className="w-4 h-4" /> 테스트 지우기
                        </Button>
                    </div>
                    <div className="p-4 bg-muted/30 border-b text-left text-sm font-medium text-muted-foreground shrink-0">
                        이곳에 마우스나 펜슬로 그림을 그려 터치감을 테스트해보세요.
                    </div>
                    <div className="flex-1 relative">
                        <FreehandCanvas
                            color={playerColor}
                            width={6}
                            disabled={isReady}
                            initialStrokes={strokes}
                            onStrokeEnd={(s) => addStroke(s)}
                        />

                        {/* Overlay if ready */}
                        {isReady && (
                            <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px] flex items-center justify-center z-20">
                                <div className="bg-card border shadow-lg rounded-full px-6 py-3 font-semibold flex items-center gap-3">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                                    </span>
                                    파트너의 준비를 기다리는 중입니다...
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}

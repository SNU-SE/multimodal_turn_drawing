import { VideoTile } from './VideoTile'
import { useMediaStore } from '../../store/mediaStore'

interface VideoPanelProps {
  myLabel: string
  partnerLabel: string
  isRecording?: boolean
}

export function VideoPanel({
  myLabel,
  partnerLabel,
  isRecording,
}: VideoPanelProps) {
  const { localCameraTrack, remoteCameraTrack, isMicMuted, toggleMic } =
    useMediaStore()

  return (
    <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
      {/* Partner video (main, full size) */}
      <VideoTile track={remoteCameraTrack} label={partnerLabel} />

      {/* My video (PiP, bottom-right corner) */}
      <div className="absolute bottom-2 right-2 w-[30%] z-10 rounded-md overflow-hidden shadow-lg ring-1 ring-black/20">
        <VideoTile
          track={localCameraTrack}
          label={myLabel}
          isMirrored
          isMuted={isMicMuted}
          onToggleMute={toggleMic}
          showMuteButton
        />
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 text-xs text-red-500 font-medium bg-black/50 px-2 py-1 rounded-full">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          녹화중
        </div>
      )}
    </div>
  )
}

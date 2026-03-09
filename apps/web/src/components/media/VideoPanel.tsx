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
    <div className="flex flex-col gap-2">
      {/* Partner video (top) */}
      <VideoTile track={remoteCameraTrack} label={partnerLabel} />
      {/* My video (bottom, mirrored) */}
      <VideoTile
        track={localCameraTrack}
        label={myLabel}
        isMirrored
        isMuted={isMicMuted}
        onToggleMute={toggleMic}
        showMuteButton
      />
      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium px-1">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          녹화중
        </div>
      )}
    </div>
  )
}

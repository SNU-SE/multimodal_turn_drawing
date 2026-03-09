import { useEffect, useRef } from 'react'
import type { Track } from 'livekit-client'

interface VideoTileProps {
  track: Track | null
  label: string
  isMirrored?: boolean
  isMuted?: boolean // for self-view audio muting
  onToggleMute?: () => void
  showMuteButton?: boolean
}

export function VideoTile({
  track,
  label,
  isMirrored,
  isMuted,
  onToggleMute,
  showMuteButton,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el || !track) return
    // livekit track.attach() returns the element it attached to
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  return (
    <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMirrored} // mute self-view to prevent echo
          className={`w-full h-full object-cover ${isMirrored ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-gray-500 text-sm">
          카메라 대기 중...
        </div>
      )}
      {/* Label overlay */}
      <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
        {label}
      </div>
      {/* Mute button overlay */}
      {showMuteButton && onToggleMute && (
        <button
          onClick={onToggleMute}
          className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-2 py-1 rounded hover:bg-black/80 transition"
        >
          {isMuted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
      )}
    </div>
  )
}

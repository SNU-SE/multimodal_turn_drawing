import { create } from 'zustand'
import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  LocalAudioTrack,
  RemoteVideoTrack,
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  VideoPresets,
  createLocalTracks,
} from 'livekit-client'
import { LIVEKIT_URL, fetchLivekitToken } from '@/lib/livekit'

interface MediaState {
  // Connection
  livekitRoom: Room | null
  isConnected: boolean
  isConnecting: boolean
  error: string | null

  // Local tracks
  localCameraTrack: LocalVideoTrack | null
  localMicTrack: LocalAudioTrack | null
  localCanvasTrack: LocalVideoTrack | null

  // Local track toggles
  isMicMuted: boolean
  isCameraOff: boolean

  // Remote tracks
  remoteCameraTrack: RemoteVideoTrack | null
  remoteMicTrack: RemoteAudioTrack | null
  remoteCanvasTrack: RemoteVideoTrack | null

  // Actions
  initLocalMedia: () => Promise<void>
  connectToRoom: (roomId: string, participantName: string, role: 'player' | 'admin') => Promise<void>
  publishCanvasTrack: (canvasElement: HTMLCanvasElement) => Promise<void>
  toggleMic: () => Promise<void>
  toggleCamera: () => Promise<void>
  disconnect: () => void
  cleanup: () => void
}

export const useMediaStore = create<MediaState>((set, get) => ({
  // Connection
  livekitRoom: null,
  isConnected: false,
  isConnecting: false,
  error: null,

  // Local tracks
  localCameraTrack: null,
  localMicTrack: null,
  localCanvasTrack: null,

  // Local track toggles
  isMicMuted: false,
  isCameraOff: false,

  // Remote tracks
  remoteCameraTrack: null,
  remoteMicTrack: null,
  remoteCanvasTrack: null,

  initLocalMedia: async () => {
    try {
      const tracks = await createLocalTracks({
        video: {
          resolution: VideoPresets.h720.resolution,
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      let localCameraTrack: LocalVideoTrack | null = null
      let localMicTrack: LocalAudioTrack | null = null

      for (const track of tracks) {
        if (track.kind === Track.Kind.Video) {
          localCameraTrack = track as LocalVideoTrack
        } else if (track.kind === Track.Kind.Audio) {
          localMicTrack = track as LocalAudioTrack
        }
      }

      set({ localCameraTrack, localMicTrack, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize local media'
      set({ error: message })
    }
  },

  connectToRoom: async (roomId: string, participantName: string, role: 'player' | 'admin') => {
    const { localCameraTrack, localMicTrack } = get()

    set({ isConnecting: true, error: null })

    try {
      const token = await fetchLivekitToken(roomId, participantName, role)

      const room = new Room()

      // Set up event handlers
      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video && track.source === Track.Source.Camera) {
            set({ remoteCameraTrack: track as RemoteVideoTrack })
          } else if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
            set({ remoteCanvasTrack: track as RemoteVideoTrack })
          } else if (track.kind === Track.Kind.Audio) {
            set({ remoteMicTrack: track as RemoteAudioTrack })
          }
        },
      )

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video && track.source === Track.Source.Camera) {
            set({ remoteCameraTrack: null })
          } else if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
            set({ remoteCanvasTrack: null })
          } else if (track.kind === Track.Kind.Audio) {
            set({ remoteMicTrack: null })
          }
        },
      )

      room.on(RoomEvent.Disconnected, () => {
        set({
          isConnected: false,
          remoteCameraTrack: null,
          remoteMicTrack: null,
          remoteCanvasTrack: null,
        })
      })

      await room.connect(LIVEKIT_URL, token)

      // Publish local tracks for players only; admins connect as subscriber-only
      if (role === 'player') {
        if (localCameraTrack) {
          await room.localParticipant.publishTrack(localCameraTrack, {
            source: Track.Source.Camera,
          })
        }
        if (localMicTrack) {
          await room.localParticipant.publishTrack(localMicTrack, {
            source: Track.Source.Microphone,
          })
        }
      }

      set({ livekitRoom: room, isConnected: true, isConnecting: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to room'
      set({ error: message, isConnecting: false })
    }
  },

  publishCanvasTrack: async (canvasElement: HTMLCanvasElement) => {
    const { livekitRoom } = get()
    if (!livekitRoom) return

    const stream = canvasElement.captureStream(30)
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) return

    const localTrack = new LocalVideoTrack(videoTrack)
    await livekitRoom.localParticipant.publishTrack(localTrack, {
      source: Track.Source.ScreenShare,
    })

    set({ localCanvasTrack: localTrack })
  },

  toggleMic: async () => {
    const { localMicTrack, isMicMuted } = get()
    if (!localMicTrack) return

    if (isMicMuted) {
      await localMicTrack.unmute()
    } else {
      await localMicTrack.mute()
    }

    set({ isMicMuted: !isMicMuted })
  },

  toggleCamera: async () => {
    const { localCameraTrack, isCameraOff } = get()
    if (!localCameraTrack) return

    if (isCameraOff) {
      await localCameraTrack.unmute()
    } else {
      await localCameraTrack.mute()
    }

    set({ isCameraOff: !isCameraOff })
  },

  disconnect: () => {
    const { livekitRoom, localCameraTrack, localMicTrack, localCanvasTrack } = get()

    localCameraTrack?.stop()
    localMicTrack?.stop()
    localCanvasTrack?.stop()

    if (livekitRoom) {
      livekitRoom.disconnect()
    }

    set({
      livekitRoom: null,
      isConnected: false,
      isConnecting: false,
      error: null,
      localCameraTrack: null,
      localMicTrack: null,
      localCanvasTrack: null,
      isMicMuted: false,
      isCameraOff: false,
      remoteCameraTrack: null,
      remoteMicTrack: null,
      remoteCanvasTrack: null,
    })
  },

  cleanup: () => {
    get().disconnect()
  },
}))

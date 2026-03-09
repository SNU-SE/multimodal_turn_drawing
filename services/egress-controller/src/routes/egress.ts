import { Router } from 'express'
import {
  EgressClient,
  RoomServiceClient,
  EncodedFileOutput,
  EncodedFileType,
} from 'livekit-server-sdk'
import fs from 'fs'
import path from 'path'
import { supabase } from '../lib/supabase.js'
import { queuePostProcess } from '../postprocess.js'

const router = Router()

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://localhost:7880'
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret'
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

// Player identities used in LiveKit rooms
const P1_IDENTITY = '플레이어 1'
const P2_IDENTITY = '플레이어 2'

// Egress job definitions: 4 recordings per session
const EGRESS_JOBS = [
  { identity: P1_IDENTITY, screenShare: false, fileType: 'p1_face' as const, fileName: 'p1_face.mp4' },
  { identity: P1_IDENTITY, screenShare: true,  fileType: 'p1_screen' as const, fileName: 'p1_screen.mp4' },
  { identity: P2_IDENTITY, screenShare: false, fileType: 'p2_face' as const, fileName: 'p2_face.mp4' },
  { identity: P2_IDENTITY, screenShare: true,  fileType: 'p2_screen' as const, fileName: 'p2_screen.mp4' },
] as const

// POST /api/egress/start — triggered when room status → 'playing'
router.post('/start', async (req, res) => {
  try {
    const { roomId } = req.body
    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' })
      return
    }

    const roomName = `room:${roomId}`

    // Idempotency: check if already recording
    const { data: existing } = await supabase
      .from('room_media_sessions')
      .select('id')
      .eq('room_id', roomId)
      .eq('livekit_status', 'active')
      .maybeSingle()

    if (existing) {
      res.json({ sessionId: existing.id, roomName, status: 'already_recording' })
      return
    }

    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

    // Verify both participants are connected
    const participants = await roomService.listParticipants(roomName)
    const identities = participants.map((p) => p.identity)

    if (!identities.includes(P1_IDENTITY) || !identities.includes(P2_IDENTITY)) {
      console.warn(
        `Missing participants in ${roomName}. Found: [${identities.join(', ')}], ` +
        `need: [${P1_IDENTITY}, ${P2_IDENTITY}]`
      )
      res.status(409).json({
        error: 'Both participants must be connected before starting egress',
        found: identities,
        required: [P1_IDENTITY, P2_IDENTITY],
      })
      return
    }

    // Create media session record
    const { data: session, error: sessionError } = await supabase
      .from('room_media_sessions')
      .insert({
        room_id: roomId,
        livekit_room_name: roomName,
        livekit_status: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (sessionError || !session) {
      console.error('Failed to create media session:', sessionError)
      res.status(500).json({ error: 'Failed to create media session' })
      return
    }

    const sessionId = session.id as string

    // Ensure recording directory exists
    const roomDir = path.join(RECORDINGS_DIR, roomId)
    fs.mkdirSync(roomDir, { recursive: true })

    // Start 4 participant egress recordings
    const egressResults: Array<{ fileType: string; egressId: string; filePath: string }> = []
    const errors: Array<{ fileType: string; error: string }> = []

    for (const job of EGRESS_JOBS) {
      const filePath = path.join(roomDir, job.fileName)
      try {
        const output = new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: filePath,
        })

        const egressInfo = await egressClient.startParticipantEgress(
          roomName,
          job.identity,
          { file: output },
          { screenShare: job.screenShare },
        )

        const egressId = egressInfo.egressId
        egressResults.push({ fileType: job.fileType, egressId, filePath })

        console.log(
          `Started egress ${egressId} for ${job.fileType} in room ${roomName}`
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`Failed to start egress for ${job.fileType}:`, err)
        errors.push({ fileType: job.fileType, error: errorMsg })
      }
    }

    // Insert recording_files rows for successful egresses
    if (egressResults.length > 0) {
      const rows = egressResults.map((r) => ({
        room_id: roomId,
        session_id: sessionId,
        file_type: r.fileType,
        file_path: r.filePath,
        status: 'recording',
        egress_id: r.egressId,
      }))

      const { error: insertError } = await supabase
        .from('recording_files')
        .insert(rows)

      if (insertError) {
        console.error('Failed to insert recording_files:', insertError)
      }
    }

    if (egressResults.length === 0) {
      res.status(500).json({
        error: 'All egress recordings failed to start',
        errors,
      })
      return
    }

    res.json({
      sessionId,
      roomName,
      status: 'recording',
      started: egressResults.length,
      failed: errors.length,
      egressIds: egressResults.map((r) => r.egressId),
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('Egress start error:', err)
    res.status(500).json({ error: 'Failed to start egress' })
  }
})

// POST /api/egress/stop — triggered when room status → 'completed'
router.post('/stop', async (req, res) => {
  try {
    const { roomId } = req.body
    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' })
      return
    }

    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

    // Get active session for this room
    const { data: session } = await supabase
      .from('room_media_sessions')
      .select('id')
      .eq('room_id', roomId)
      .eq('livekit_status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    const sessionId = session?.id as string | undefined

    // Get all active egress recording files
    const { data: recordings } = await supabase
      .from('recording_files')
      .select('id, egress_id, file_type')
      .eq('room_id', roomId)
      .eq('status', 'recording')

    const stopped: string[] = []
    const stopErrors: Array<{ egressId: string; error: string }> = []

    if (recordings) {
      for (const rec of recordings) {
        if (rec.egress_id) {
          try {
            await egressClient.stopEgress(rec.egress_id)
            stopped.push(rec.egress_id)
            console.log(`Stopped egress ${rec.egress_id} (${rec.file_type})`)
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e)
            console.error(`Failed to stop egress ${rec.egress_id}:`, e)
            stopErrors.push({ egressId: rec.egress_id, error: errorMsg })
          }
        }
      }
    }

    // Update session status
    await supabase
      .from('room_media_sessions')
      .update({
        livekit_status: 'completed',
        ended_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .eq('livekit_status', 'active')

    // Update recording files status to processing
    await supabase
      .from('recording_files')
      .update({ status: 'processing' })
      .eq('room_id', roomId)
      .eq('status', 'recording')

    // Queue post-processing (composite video creation)
    if (sessionId) {
      queuePostProcess(roomId, sessionId)
      console.log(`Queued post-processing for room ${roomId}, session ${sessionId}`)
    } else {
      console.warn(`No active session found for room ${roomId}, skipping post-processing`)
    }

    res.json({
      status: 'stopped',
      stopped: stopped.length,
      errors: stopErrors.length > 0 ? stopErrors : undefined,
      message: 'All egress stopped, post-processing queued',
    })
  } catch (err) {
    console.error('Egress stop error:', err)
    res.status(500).json({ error: 'Failed to stop egress' })
  }
})

// GET /api/egress/status/:roomId — check recording status
router.get('/status/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params

    const { data: session } = await supabase
      .from('room_media_sessions')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const { data: recordings } = await supabase
      .from('recording_files')
      .select('*')
      .eq('room_id', roomId)

    res.json({ session, recordings })
  } catch (err) {
    console.error('Status check error:', err)
    res.status(500).json({ error: 'Failed to check status' })
  }
})

export default router

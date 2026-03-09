import { Router } from 'express'
import { EgressClient, TrackSource, EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk'
import { supabase } from '../lib/supabase.js'

const router = Router()

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://localhost:7880'
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret'
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

// POST /api/egress/start — triggered when room status → 'playing'
router.post('/start', async (req, res) => {
  try {
    const { roomId } = req.body
    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' })
      return
    }

    const roomName = `room:${roomId}`
    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

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

    // Get room participants to find their track SIDs
    // Note: tracks need to be published before we can start track egress
    // We'll start egress after a short delay or use room composite as fallback

    // For now, store session info — actual egress will be triggered
    // when participants publish their tracks (via webhook or polling)

    res.json({
      sessionId: session.id,
      roomName,
      status: 'session_created',
      message: 'Media session created. Track egress will start when participants publish tracks.'
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

    // Get all active egress for this room's recording files
    const { data: recordings } = await supabase
      .from('recording_files')
      .select('egress_id')
      .eq('room_id', roomId)
      .eq('status', 'recording')

    if (recordings) {
      for (const rec of recordings) {
        if (rec.egress_id) {
          try {
            await egressClient.stopEgress(rec.egress_id)
          } catch (e) {
            console.error(`Failed to stop egress ${rec.egress_id}:`, e)
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

    // Update recording files status
    await supabase
      .from('recording_files')
      .update({ status: 'processing' })
      .eq('room_id', roomId)
      .eq('status', 'recording')

    res.json({ status: 'stopped', message: 'All egress stopped, post-processing queued' })
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

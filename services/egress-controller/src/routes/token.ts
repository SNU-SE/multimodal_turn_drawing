import { Router } from 'express'
import { AccessToken } from 'livekit-server-sdk'

const router = Router()

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret'

router.post('/', async (req, res) => {
  try {
    const { roomName, participantName, role } = req.body

    if (!roomName || !participantName) {
      res.status(400).json({ error: 'roomName and participantName are required' })
      return
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantName,
      name: participantName,
    })

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: role !== 'admin',
      canSubscribe: true,
      canPublishData: role !== 'admin',
    })

    const jwt = await token.toJwt()
    res.json({ token: jwt })
  } catch (err) {
    console.error('Token generation error:', err)
    res.status(500).json({ error: 'Failed to generate token' })
  }
})

export default router

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://livekit.example.com'
const EGRESS_CONTROLLER_URL = import.meta.env.VITE_EGRESS_CONTROLLER_URL || 'https://egress.example.com'

export { LIVEKIT_URL, EGRESS_CONTROLLER_URL }

export async function fetchLivekitToken(
  roomName: string,
  participantName: string,
  role: 'player' | 'admin'
): Promise<string> {
  const res = await fetch(`${EGRESS_CONTROLLER_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName, participantName, role }),
  })
  if (!res.ok) throw new Error('Failed to fetch LiveKit token')
  const data = await res.json()
  return data.token
}

export async function startEgress(roomId: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${EGRESS_CONTROLLER_URL}/api/egress/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || 'Failed to start egress')
  }
  return res.json()
}

export async function stopEgress(roomId: string): Promise<void> {
  const res = await fetch(`${EGRESS_CONTROLLER_URL}/api/egress/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  })
  if (!res.ok) {
    console.error('[stopEgress] Failed:', await res.text())
  }
}

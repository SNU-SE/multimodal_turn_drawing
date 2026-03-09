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

# Recording Pipeline Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the disconnected recording pipeline so LiveKit egress actually records player video/canvas tracks, saves them as MP4 files, composites them, and uploads to Google Drive.

**Architecture:** Web app (Player 1) triggers egress-controller API after both players publish tracks. Egress-controller uses `startParticipantEgress` (4 calls per room: P1 face, P1 screen, P2 face, P2 screen). On game completion, web app triggers stop → egress stops → post-processing creates composite → cron uploads to Google Drive.

**Tech Stack:** LiveKit Server SDK v2.9.1 (`EgressClient`, `RoomServiceClient`, `EncodedFileOutput`), React/Zustand (frontend trigger), Express (egress-controller), FFmpeg (post-processing), rclone (Google Drive upload)

---

## Context

**Design spec:** `docs/plans/2026-03-09-research-video-conferencing-design.md`

**Problem:** Three breaks in the recording pipeline:
1. Web app never calls `/api/egress/start` or `/stop`
2. Egress-controller `/start` creates DB record but never calls `startParticipantEgress()`
3. Egress-controller `/stop` never calls `queuePostProcess()`

**LiveKit participant identities:** Players connect as `"플레이어 1"` and `"플레이어 2"` (set in MainGame.tsx line 34-35, used as LiveKit identity in mediaStore.ts connectToRoom).

**LiveKit room name format:** `"room:{roomId}"` (set in egress.ts line 21, and token.ts passes through from client).

**Recordings directory:** `/recordings/{roomId}/` — shared Docker volume between egress service and egress-controller.

**File naming convention (from postprocess.ts):** `p1_face.mp4`, `p2_face.mp4`, `p1_screen.mp4`, `p2_screen.mp4`, `composite.mp4`

---

### Task 1: Add egress API helpers to frontend

**Files:**
- Modify: `apps/web/src/lib/livekit.ts`

**Step 1: Add startEgress and stopEgress functions**

```typescript
// Add to apps/web/src/lib/livekit.ts

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
```

**Step 2: Verify build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/lib/livekit.ts
git commit -m "feat: add egress start/stop API helpers to livekit client"
```

---

### Task 2: Implement actual egress start in egress-controller

**Files:**
- Modify: `services/egress-controller/src/routes/egress.ts`

**Step 1: Rewrite the /start endpoint**

Replace the entire `/start` handler with code that:
1. Creates `room_media_sessions` record (existing logic)
2. Uses `RoomServiceClient.listParticipants()` to verify both players are connected
3. Starts 4x `startParticipantEgress()` — P1 face, P1 screen, P2 face, P2 screen
4. Creates 4x `recording_files` records with egress IDs
5. Ensures recording directory exists

```typescript
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

const router = Router()

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://localhost:7880'
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey'
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret'
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

interface EgressJob {
  identity: string
  fileType: string
  screenShare: boolean
  filename: string
}

const EGRESS_JOBS: EgressJob[] = [
  { identity: '플레이어 1', fileType: 'p1_face', screenShare: false, filename: 'p1_face.mp4' },
  { identity: '플레이어 1', fileType: 'p1_screen', screenShare: true, filename: 'p1_screen.mp4' },
  { identity: '플레이어 2', fileType: 'p2_face', screenShare: false, filename: 'p2_face.mp4' },
  { identity: '플레이어 2', fileType: 'p2_screen', screenShare: true, filename: 'p2_screen.mp4' },
]

// POST /api/egress/start
router.post('/start', async (req, res) => {
  try {
    const { roomId } = req.body
    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' })
      return
    }

    const roomName = `room:${roomId}`
    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

    // Verify both participants are in the room
    const participants = await roomService.listParticipants(roomName)
    const playerIdentities = participants.map((p) => p.identity)
    console.log(`[egress/start] Room ${roomName} participants: ${playerIdentities.join(', ')}`)

    if (participants.length < 2) {
      res.status(400).json({
        error: 'Both players must be connected before starting recording',
        participants: playerIdentities,
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
      console.error('[egress/start] Failed to create media session:', sessionError)
      res.status(500).json({ error: 'Failed to create media session' })
      return
    }

    // Ensure recording directory exists
    const roomDir = path.join(RECORDINGS_DIR, roomId)
    if (!fs.existsSync(roomDir)) {
      fs.mkdirSync(roomDir, { recursive: true })
    }

    // Start 4x ParticipantEgress
    const results: Array<{ fileType: string; egressId: string }> = []
    const errors: Array<{ fileType: string; error: string }> = []

    for (const job of EGRESS_JOBS) {
      // Skip if participant not in room
      if (!playerIdentities.includes(job.identity)) {
        errors.push({ fileType: job.fileType, error: `Participant ${job.identity} not found` })
        continue
      }

      try {
        const filepath = path.join(roomDir, job.filename)
        const fileOutput = new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath,
        })

        const egressInfo = await egressClient.startParticipantEgress(
          roomName,
          job.identity,
          { file: fileOutput },
          { screenShare: job.screenShare },
        )

        const egressId = egressInfo.egressId
        console.log(`[egress/start] Started ${job.fileType} egress: ${egressId}`)

        // Create recording_files record
        await supabase.from('recording_files').insert({
          room_id: roomId,
          session_id: session.id,
          file_type: job.fileType,
          file_path: filepath,
          status: 'recording',
          egress_id: egressId,
        })

        results.push({ fileType: job.fileType, egressId })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[egress/start] Failed to start ${job.fileType} egress:`, msg)
        errors.push({ fileType: job.fileType, error: msg })
      }
    }

    res.json({
      sessionId: session.id,
      roomName,
      started: results,
      errors,
      status: results.length > 0 ? 'recording' : 'failed',
    })
  } catch (err) {
    console.error('[egress/start] Error:', err)
    res.status(500).json({ error: 'Failed to start egress' })
  }
})
```

**Step 2: Verify TypeScript compilation**

Run: `cd services/egress-controller && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add services/egress-controller/src/routes/egress.ts
git commit -m "feat: implement actual ParticipantEgress recording in /start endpoint"
```

---

### Task 3: Wire up /stop to queuePostProcess

**Files:**
- Modify: `services/egress-controller/src/routes/egress.ts`

**Step 1: Import queuePostProcess and add it to /stop handler**

Add import at top of file:
```typescript
import { queuePostProcess } from '../postprocess.js'
```

In the `/stop` handler, after the recording_files status update, add the post-processing call:

```typescript
// POST /api/egress/stop
router.post('/stop', async (req, res) => {
  try {
    const { roomId } = req.body
    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' })
      return
    }

    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

    // Get all active egress for this room
    const { data: recordings } = await supabase
      .from('recording_files')
      .select('egress_id, session_id')
      .eq('room_id', roomId)
      .eq('status', 'recording')

    let stoppedCount = 0
    let sessionId: string | null = null

    if (recordings) {
      for (const rec of recordings) {
        if (!sessionId) sessionId = rec.session_id
        if (rec.egress_id) {
          try {
            await egressClient.stopEgress(rec.egress_id)
            stoppedCount++
            console.log(`[egress/stop] Stopped egress ${rec.egress_id}`)
          } catch (e) {
            console.error(`[egress/stop] Failed to stop egress ${rec.egress_id}:`, e)
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

    // Queue post-processing
    if (sessionId) {
      console.log(`[egress/stop] Queueing post-processing for room ${roomId}`)
      queuePostProcess(roomId, sessionId)
    }

    res.json({
      status: 'stopped',
      stoppedCount,
      message: 'Egress stopped, post-processing queued',
    })
  } catch (err) {
    console.error('[egress/stop] Error:', err)
    res.status(500).json({ error: 'Failed to stop egress' })
  }
})
```

**Step 2: Verify TypeScript compilation**

Run: `cd services/egress-controller && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add services/egress-controller/src/routes/egress.ts
git commit -m "feat: wire up /stop endpoint to queuePostProcess for FFmpeg composite"
```

---

### Task 4: Add recording triggers in MainGame.tsx

**Files:**
- Modify: `apps/web/src/pages/room/MainGame.tsx`

**Step 1: Add egress trigger effect**

Import `startEgress` and `stopEgress` from livekit.ts. Add a useEffect that:
- Watches for `remoteCameraTrack` (meaning partner has published)
- Only Player 1 triggers (to avoid duplicate calls)
- Calls `startEgress(room.id)` once
- Uses a ref to prevent duplicate calls

Add after the existing LiveKit connection effect (around line 98):

```typescript
import { startEgress, stopEgress } from '@/lib/livekit'

// ... inside MainGame component:

// Start recording when both players have published tracks
const egressStartedRef = useRef(false)

useEffect(() => {
    if (!room?.id || !isPlayer1 || egressStartedRef.current) return
    if (room?.status !== 'playing') return

    const ms = useMediaStore.getState()
    if (!ms.isConnected || !ms.remoteCameraTrack) return

    egressStartedRef.current = true
    startEgress(room.id)
        .then((res) => console.log('[MainGame] Egress started:', res))
        .catch((err) => console.error('[MainGame] Failed to start egress:', err))
}, [room?.id, room?.status, isPlayer1, useMediaStore.getState().remoteCameraTrack])
```

Note: The dependency on `remoteCameraTrack` requires reading from the store reactively. Since the component already calls `useMediaStore()` at the top (line 29), it re-renders on any mediaStore change. But `useMediaStore.getState().remoteCameraTrack` in the dep array won't trigger re-renders. Instead, use the store's state directly:

```typescript
const { remoteCameraTrack, isConnected: mediaConnected } = useMediaStore()

// Start recording when both players have published tracks
const egressStartedRef = useRef(false)

useEffect(() => {
    if (!room?.id || !isPlayer1 || egressStartedRef.current) return
    if (room?.status !== 'playing') return
    if (!mediaConnected || !remoteCameraTrack) return

    egressStartedRef.current = true
    startEgress(room.id)
        .then((res) => console.log('[MainGame] Egress started:', res))
        .catch((err) => console.error('[MainGame] Failed to start egress:', err))
}, [room?.id, room?.status, isPlayer1, mediaConnected, remoteCameraTrack])
```

**Step 2: Add egress stop trigger**

Add a useEffect that calls `stopEgress` when room status becomes `'completed'`:

```typescript
// Stop recording when game ends
useEffect(() => {
    if (!room?.id || room?.status !== 'completed') return
    if (!egressStartedRef.current) return

    stopEgress(room.id)
        .then(() => console.log('[MainGame] Egress stopped'))
        .catch((err) => console.error('[MainGame] Failed to stop egress:', err))
}, [room?.id, room?.status])
```

**Step 3: Fix the misleading isRecording prop**

The `isRecording` prop on VideoPanel currently shows "녹화중" whenever status is 'playing'. Now that we have actual recording state, we can tie it to `egressStartedRef`. For simplicity, keep the existing behavior (it's now accurate since recording will actually start when playing).

**Step 4: Verify build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add apps/web/src/pages/room/MainGame.tsx
git commit -m "feat: trigger egress recording start/stop from MainGame"
```

---

### Task 5: Fix postprocess.ts status updates

**Files:**
- Modify: `services/egress-controller/src/postprocess.ts`

**Step 1: Update recording_files status after successful composite**

In `createComposite()`, after the composite insert, update all 4 track files to 'processing' (they stay as 'processing' until rclone uploads them). Also handle the missing file case more gracefully by updating status to 'failed':

In the missing file check (line 54-58), replace the silent return with:
```typescript
for (const input of inputs) {
  if (!fs.existsSync(input)) {
    console.error(`[postprocess] Missing input file: ${input}`)
    // Update status to failed so admin can see what happened
    await supabase
      .from('recording_files')
      .update({ status: 'failed' })
      .eq('room_id', roomId)
      .eq('session_id', sessionId)
    return
  }
}
```

**Step 2: Verify compilation**

Run: `cd services/egress-controller && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add services/egress-controller/src/postprocess.ts
git commit -m "fix: update recording status to failed when input files missing"
```

---

### Task 6: Fix upload script to update Supabase

**Files:**
- Modify: `services/scripts/upload-recordings.sh`

**Step 1: Add Supabase update after successful upload**

The upload script needs to update `recording_files` with gdrive_url and status. Since the script is bash, use curl to call the Supabase REST API:

```bash
#!/bin/bash
# Upload completed recordings to Google Drive
# Run via cron: */5 * * * * /opt/scripts/upload-recordings.sh

RECORDINGS_DIR="${RECORDINGS_DIR:-/recordings}"
GDRIVE_REMOTE="gdrive:/연구녹화"
LOG_FILE="/var/log/rclone-upload.log"
DATE_FOLDER=$(date +%Y-%m-%d)
SUPABASE_URL="${SUPABASE_URL:-https://supabase.bioclass.kr}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"

# Only process directories that have a composite.mp4 (post-processing complete)
for room_dir in "$RECORDINGS_DIR"/*/; do
  [ -d "$room_dir" ] || continue

  room_id=$(basename "$room_dir")
  composite="$room_dir/composite.mp4"

  if [ -f "$composite" ]; then
    echo "$(date): Uploading $room_id to Google Drive..." >> "$LOG_FILE"

    rclone copy "$room_dir" "$GDRIVE_REMOTE/$DATE_FOLDER/$room_id/" \
      --log-file "$LOG_FILE" \
      --log-level INFO \
      --min-age 1m

    if [ $? -eq 0 ]; then
      GDRIVE_BASE="$GDRIVE_REMOTE/$DATE_FOLDER/$room_id"
      echo "$(date): Upload complete for $room_id" >> "$LOG_FILE"

      # Update recording_files in Supabase
      if [ -n "$SUPABASE_SERVICE_KEY" ]; then
        # Update all recording files for this room to 'uploaded'
        curl -s -X PATCH \
          "$SUPABASE_URL/rest/v1/recording_files?room_id=eq.$room_id&status=eq.processing" \
          -H "apikey: $SUPABASE_SERVICE_KEY" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"status\": \"uploaded\", \"gdrive_url\": \"$GDRIVE_BASE\"}" \
          >> "$LOG_FILE" 2>&1
        echo "$(date): DB updated for $room_id" >> "$LOG_FILE"
      fi

      # Remove local files after successful upload
      rm -rf "$room_dir"
      echo "$(date): Local files cleaned for $room_id" >> "$LOG_FILE"
    else
      echo "$(date): Upload FAILED for $room_id" >> "$LOG_FILE"
    fi
  fi
done
```

Key changes from original:
- `rclone copy` instead of `rclone move` (safer — copy first, then delete after success)
- Added Supabase REST API call to update recording_files status and gdrive_url
- Added error checking on rclone exit code
- Added `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` env vars

**Step 2: Commit**

```bash
git add services/scripts/upload-recordings.sh
git commit -m "feat: update Supabase recording status after Google Drive upload"
```

---

### Task 7: Rebuild and deploy egress-controller to VPS2

**Step 1: Build egress-controller Docker image**

Run: `cd services/egress-controller && docker build -t egress-controller .`
(or build on VPS2 directly)

**Step 2: Deploy to VPS2**

```bash
# On VPS2:
cd ~/livekit
docker compose down egress-controller
docker compose up -d egress-controller
docker logs -f livekit-egress-controller-1
```

Verify logs show: `Egress controller running on port 3000`

**Step 3: Deploy updated upload script to VPS2**

```bash
scp services/scripts/upload-recordings.sh vps2:/opt/scripts/upload-recordings.sh
```

**Step 4: Verify web app build**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit all and push**

```bash
git push origin research
```

---

## Verification Checklist

After all tasks are complete:

1. [ ] `npx tsc --noEmit` passes in both `apps/web` and `services/egress-controller`
2. [ ] `npm run build` passes in `apps/web`
3. [ ] egress-controller Docker image builds
4. [ ] Two players join a room → `room_media_sessions` record created with status 'active'
5. [ ] `recording_files` table has 4 rows (p1_face, p1_screen, p2_face, p2_screen) with egress_ids
6. [ ] Game completes → egress stops → `recording_files` status changes to 'processing'
7. [ ] FFmpeg composite runs → `composite.mp4` created in `/recordings/{roomId}/`
8. [ ] Cron runs → files uploaded to Google Drive → `recording_files` status changes to 'uploaded'

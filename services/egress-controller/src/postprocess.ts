import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { supabase } from './lib/supabase.js'

const execAsync = promisify(exec)
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/recordings'

interface PostProcessJob {
  roomId: string
  sessionId: string
}

const processingQueue: PostProcessJob[] = []
let isProcessing = false

export function queuePostProcess(roomId: string, sessionId: string) {
  processingQueue.push({ roomId, sessionId })
  processNext()
}

async function processNext() {
  if (isProcessing || processingQueue.length === 0) return
  isProcessing = true

  const job = processingQueue.shift()!
  try {
    await createComposite(job.roomId, job.sessionId)
  } catch (err) {
    console.error(`Post-processing failed for room ${job.roomId}:`, err)
    await supabase
      .from('recording_files')
      .update({ status: 'failed' })
      .eq('room_id', job.roomId)
      .eq('file_type', 'composite')
  } finally {
    isProcessing = false
    processNext()
  }
}

async function createComposite(roomId: string, sessionId: string) {
  const roomDir = path.join(RECORDINGS_DIR, roomId)

  const p1Face = path.join(roomDir, 'p1_face.mp4')
  const p2Face = path.join(roomDir, 'p2_face.mp4')
  const p1Screen = path.join(roomDir, 'p1_screen.mp4')
  const p2Screen = path.join(roomDir, 'p2_screen.mp4')
  const output = path.join(roomDir, 'composite.mp4')

  // Check all input files exist
  const inputs = [p1Face, p2Face, p1Screen, p2Screen]
  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      console.warn(`Missing input file: ${input}, skipping composite`)
      return
    }
  }

  // FFmpeg command: 2x2 grid layout
  // Top row: P1 face | P2 face
  // Bottom row: P1 screen | P2 screen
  const ffmpegCmd = [
    'ffmpeg -y',
    `-i "${p1Face}" -i "${p2Face}" -i "${p1Screen}" -i "${p2Screen}"`,
    '-filter_complex',
    '"[0:v]scale=640:360[v0];[1:v]scale=640:360[v1];',
    '[2:v]scale=640:360[v2];[3:v]scale=640:360[v3];',
    '[v0][v1]hstack=inputs=2[top];',
    '[v2][v3]hstack=inputs=2[bottom];',
    '[top][bottom]vstack=inputs=2[out]"',
    '-map "[out]"',
    '-map 0:a? -map 1:a?',  // Include audio from both face videos if available
    '-c:v libx264 -preset fast -crf 23',
    '-c:a aac -b:a 128k',
    '-shortest',
    `"${output}"`,
  ].join(' ')

  console.log(`Starting composite for room ${roomId}...`)
  await execAsync(ffmpegCmd, { timeout: 600000 }) // 10 min timeout

  // Get file size
  const stats = fs.statSync(output)

  // Update recording_files with composite info
  await supabase
    .from('recording_files')
    .insert({
      room_id: roomId,
      session_id: sessionId,
      file_type: 'composite',
      file_path: output,
      file_size: stats.size,
      status: 'processing', // Will be 'uploaded' after rclone moves it
    })

  // Generate metadata.json
  await generateMetadata(roomId, roomDir)

  console.log(`Composite complete for room ${roomId}: ${output}`)
}

async function generateMetadata(roomId: string, roomDir: string) {
  // Fetch room data
  const { data: room } = await supabase
    .from('rooms')
    .select('*, room_groups(*)')
    .eq('id', roomId)
    .single()

  // Fetch players
  const playerIds = [room?.player1_id, room?.player2_id].filter(Boolean)
  const { data: players } = await supabase
    .from('users')
    .select('*')
    .in('id', playerIds)

  // Fetch questions and answers
  const { data: roomQuestions } = await supabase
    .from('room_questions')
    .select('*, questions(*)')
    .eq('room_id', roomId)

  // Fetch session info
  const { data: session } = await supabase
    .from('room_media_sessions')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Fetch recording files
  const { data: recordings } = await supabase
    .from('recording_files')
    .select('*')
    .eq('room_id', roomId)

  const metadata = {
    room_id: roomId,
    room_code: room?.code,
    session_name: room?.room_groups?.name,
    recorded_at: session?.started_at,
    duration_seconds: session?.started_at && session?.ended_at
      ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
      : null,
    participants: {
      player1: {
        id: room?.player1_id,
        alias: players?.find((p: any) => p.id === room?.player1_id)?.admin_alias,
      },
      player2: {
        id: room?.player2_id,
        alias: players?.find((p: any) => p.id === room?.player2_id)?.admin_alias,
      },
    },
    questions: roomQuestions?.map((rq: any) => ({
      title: rq.questions?.title,
      submitted_answer: rq.submitted_answer,
      is_correct: rq.is_correct,
    })),
    files: recordings?.map((r: any) => ({
      type: r.file_type,
      size_bytes: r.file_size,
      status: r.status,
      gdrive_url: r.gdrive_url,
    })),
  }

  const metadataPath = path.join(roomDir, 'metadata.json')
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
}

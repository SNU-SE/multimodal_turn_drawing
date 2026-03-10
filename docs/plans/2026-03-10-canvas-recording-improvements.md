# Canvas Recording Quality Improvements

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 태블릿 그림 그리기가 녹화 영상에 정확하고 부드럽게 캡처되도록 SVG-to-Canvas 렌더 파이프라인을 개선한다.

**Architecture:** SVG 캔버스의 녹화 스트림 생성 파이프라인을 3가지 측면에서 개선: (1) 이미지 오버레이가 녹화에서 누락되는 문제를 data URL 변환으로 해결, (2) 10fps 렌더 루프를 requestAnimationFrame 기반 30fps + 더블 버퍼링으로 교체하여 부드러운 캡처와 빈 프레임 방지, (3) 5팀 동시 운영을 위한 Egress 서비스 리소스 제한 추가.

**Tech Stack:** React, TypeScript, Canvas API, requestAnimationFrame, LiveKit, Docker Compose

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/src/store/roomStore.ts` | `placeImage`에서 외부 URL → data URL 변환 |
| Modify | `apps/web/src/pages/room/MainGame.tsx` | 렌더 루프를 rAF + 더블 버퍼링으로 재작성 |
| Modify | `services/docker-compose.yml` | Egress 서비스 리소스 제한 추가 |

---

## Task 1: 이미지 오버레이 data URL 변환

**문제:** `placeImage(url)`이 외부 URL(Supabase storage)을 그대로 SVG `<image href>`에 사용. SVG가 XMLSerializer로 직렬화 → Blob → Image로 변환될 때, 격리된 컨텍스트에서 외부 URL을 로드할 수 없어 이미지가 녹화에서 누락됨.

**해결:** 이미지 배치 시 외부 URL을 fetch → blob → data URL로 변환하여 SVG에 inline으로 포함. 공통 헬퍼 함수를 `create()` 콜백 내부에 정의하여 `set` 함수에 직접 접근.

**Files:**
- Modify: `apps/web/src/store/roomStore.ts`
  - `create()` 내부(80행 부근)에 헬퍼 함수 추가
  - `placeImage` 함수 (659-678행)
  - broadcast `place_image` 핸들러 (509-514행)
  - stroke polling의 canvasImage 설정 (260-276행)
  - 초기 로드의 canvasImage 설정 (421-426행)

- [ ] **Step 1: `create()` 콜백 내부에 헬퍼 함수 정의**

`roomStore.ts`의 `create()` 콜백 시작 부분(79행 `export const useRoomStore = create<RoomState>((set, get) => {` 바로 아래, 80행 부근)에 헬퍼 추가:

```typescript
export const useRoomStore = create<RoomState>((set, get) => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollIntervalId: any = null
    let strokePollIntervalId: any = null
    let lastStrokeTimestamp: string | null = null
    let groupTimeLimit: number | null = null

    // Convert external image URL to data URL for SVG serialization compatibility.
    // SVG serialization creates an isolated context where external URLs cannot be resolved,
    // causing images to be missing from the recording stream.
    const convertImageToDataUrl = (originalUrl: string) => {
        if (!originalUrl || originalUrl.startsWith('data:')) return
        fetch(originalUrl)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader()
                reader.onloadend = () => {
                    const dataUrl = reader.result as string
                    set((state) => {
                        if (state.canvasImage && state.canvasImage.url === originalUrl) {
                            return { canvasImage: { ...state.canvasImage, url: dataUrl } }
                        }
                        return {}
                    })
                }
                reader.readAsDataURL(blob)
            })
            .catch(() => {}) // Silent fail — original URL still works for screen display
    }
```

핵심: `set`은 `create()` 콜백의 인자이므로 헬퍼에서 직접 접근 가능. 별도의 타입 선언 불필요.

- [ ] **Step 2: `placeImage` 함수에서 헬퍼 호출**

`placeImage` 함수(659행)의 마지막에 헬퍼 호출 추가. 기존 코드의 닫는 중괄호(678행) 바로 앞에 한 줄 추가:

기존 (659-678행):
```typescript
placeImage: (url: string) => {
    const image: CanvasImage = { url, x: 50, y: 50, width: 300, height: 200, visible: true }
    logger.info('[placeImage] 이미지 배치:', url)
    set({ canvasImage: image })
    logTurnEvent('image_placed', { url, questionIndex: get().room?.current_question_index || 0 })
    const { roomId, playerId } = get()

    trySend('place_image', { image })

    if (roomId && playerId) {
        supabase.from('canvas_logs').insert({
            room_id: roomId,
            player_id: playerId,
            action_type: 'place_image',
            payload: image as any
        } as any).then(({ error }) => {
            if (error) logger.error('[placeImage] DB 저장 실패:', error)
        })
    }
},
```

수정 후:
```typescript
placeImage: (url: string) => {
    const image: CanvasImage = { url, x: 50, y: 50, width: 300, height: 200, visible: true }
    logger.info('[placeImage] 이미지 배치:', url)
    set({ canvasImage: image })
    logTurnEvent('image_placed', { url, questionIndex: get().room?.current_question_index || 0 })
    const { roomId, playerId } = get()

    trySend('place_image', { image })

    if (roomId && playerId) {
        supabase.from('canvas_logs').insert({
            room_id: roomId,
            player_id: playerId,
            action_type: 'place_image',
            payload: image as any
        } as any).then(({ error }) => {
            if (error) logger.error('[placeImage] DB 저장 실패:', error)
        })
    }

    convertImageToDataUrl(url)
},
```

변경: 마지막에 `convertImageToDataUrl(url)` 한 줄 추가.

- [ ] **Step 3: broadcast 수신 핸들러에서 헬퍼 호출**

broadcast `place_image` 이벤트 핸들러(509-514행) 수정:

기존:
```typescript
channel.on('broadcast', { event: 'place_image' }, (msg) => {
    logger.info('[수신:broadcast] place_image')
    if (msg.payload?.image) {
        set({ canvasImage: msg.payload.image })
    }
})
```

수정 후:
```typescript
channel.on('broadcast', { event: 'place_image' }, (msg) => {
    logger.info('[수신:broadcast] place_image')
    if (msg.payload?.image) {
        const image = msg.payload.image as CanvasImage
        set({ canvasImage: image })
        convertImageToDataUrl(image.url)
    }
})
```

변경: `CanvasImage` 타입 캐스트 + `convertImageToDataUrl` 호출 추가.

- [ ] **Step 4: stroke polling에서 이미지 복원 시 헬퍼 호출**

stroke polling(212-278행)에서 `latestImage`가 설정된 후 state에 반영되는 두 곳(260-263행, 264-276행)에서, `set()` 호출 직후 변환 호출. 두 분기 모두 `latestImage`가 `canvasImage`에 설정되므로, 분기 이후에 한 번 호출:

기존 (260-277행):
```typescript
if (shouldClear) {
    const updates: any = { strokes: [...newStrokes] }
    if (latestImage !== undefined) updates.canvasImage = latestImage
    set(() => updates)
} else {
    set((state) => {
        let strokes = state.strokes
        if (eraseIds.size > 0) {
            strokes = strokes.filter((s: any) => !eraseIds.has(s.id))
        }
        if (newStrokes.length > 0) {
            strokes = [...strokes, ...newStrokes]
        }
        const updates: any = { strokes }
        if (latestImage !== undefined) updates.canvasImage = latestImage
        return updates
    })
}
```

수정 후 (분기 아래에 변환 호출 추가):
```typescript
if (shouldClear) {
    const updates: any = { strokes: [...newStrokes] }
    if (latestImage !== undefined) updates.canvasImage = latestImage
    set(() => updates)
} else {
    set((state) => {
        let strokes = state.strokes
        if (eraseIds.size > 0) {
            strokes = strokes.filter((s: any) => !eraseIds.has(s.id))
        }
        if (newStrokes.length > 0) {
            strokes = [...strokes, ...newStrokes]
        }
        const updates: any = { strokes }
        if (latestImage !== undefined) updates.canvasImage = latestImage
        return updates
    })
}

// Convert polled image to data URL for recording
if (latestImage && latestImage.url) {
    convertImageToDataUrl(latestImage.url)
}
```

변경: 분기 이후에 `latestImage`가 있으면 `convertImageToDataUrl` 호출.

- [ ] **Step 5: 초기 로드에서 이미지 복원 시 헬퍼 호출**

joinRoom 초기 로드(421-426행)에서 `existingImage`가 설정된 직후 변환 호출:

기존 (421-426행):
```typescript
set({
    room, roomId: room.id, playerId: assignedPlayerId,
    isPlayer1, isConnected: true, questions, roomQuestions,
    strokes: existingStrokes, canvasImage: existingImage,
    sessionTimeLimit,
})
```

수정 후:
```typescript
set({
    room, roomId: room.id, playerId: assignedPlayerId,
    isPlayer1, isConnected: true, questions, roomQuestions,
    strokes: existingStrokes, canvasImage: existingImage,
    sessionTimeLimit,
})

// Convert restored image to data URL for recording
if (existingImage && existingImage.url) {
    convertImageToDataUrl(existingImage.url)
}
```

- [ ] **Step 6: 수동 테스트**

1. 게임에서 이미지가 있는 문제를 로드
2. 이미지 배치 버튼 클릭
3. 브라우저 DevTools Console에서 `useRoomStore.getState().canvasImage.url`이 `data:image/...`로 변환되는지 확인
4. SVG 직렬화 후 hidden canvas에 이미지가 포함되는지 확인

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/store/roomStore.ts
git commit -m "fix: convert canvas image URLs to data URLs for recording compatibility"
```

---

## Task 2: 렌더 루프를 rAF + 더블 버퍼링으로 재작성

**문제:**
1. `setInterval(renderLoop, 100)` = 10fps → 그리기 과정이 뚝뚝 끊겨 녹화됨
2. 매 프레임 `canvas.width = ...` 설정으로 canvas 초기화 → async img.onload 전에 빈 프레임 캡처 가능
3. 크기 변경 없어도 매번 canvas 리셋
4. (기존 버그) async connect에서 반환된 cleanup 함수가 useEffect에 전달되지 않음

**해결:** requestAnimationFrame + 30fps 스로틀 + 더블 버퍼링 (offscreen canvas에 그린 후 main canvas로 복사) + cleanup 패턴 수정

**Files:**
- Modify: `apps/web/src/pages/room/MainGame.tsx:48-100` (LiveKit 연결 + 렌더 루프 useEffect)

- [ ] **Step 1: useEffect 전체 재작성**

`MainGame.tsx`의 48-100행 useEffect를 통째로 교체:

기존 (48-100행):
```typescript
// Connect to LiveKit when game starts playing
useEffect(() => {
    if (room?.status !== 'playing' || !room?.id || !playerId) return
    const ms = useMediaStore.getState()
    if (ms.isConnected || ms.isConnecting) return

    const connect = async () => {
        await ms.connectToRoom(room.id, myAlias, 'player')

        // After connection, set up SVG-to-canvas streaming
        const svgEl = canvasWrapperRef.current?.querySelector('svg')
        const hiddenCanvas = hiddenCanvasRef.current
        if (svgEl && hiddenCanvas) {
            const ctx = hiddenCanvas.getContext('2d')
            if (!ctx) return

            // Periodically render SVG to hidden canvas at ~10fps for stream
            const renderLoop = () => {
                const rect = svgEl.getBoundingClientRect()
                hiddenCanvas.width = rect.width
                hiddenCanvas.height = rect.height

                const svgData = new XMLSerializer().serializeToString(svgEl)
                const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const img = new Image()
                img.onload = () => {
                    ctx.clearRect(0, 0, hiddenCanvas.width, hiddenCanvas.height)
                    ctx.drawImage(img, 0, 0)
                    URL.revokeObjectURL(url)
                }
                img.src = url
            }

            // Initial render then start interval
            renderLoop()
            const intervalId = setInterval(renderLoop, 100) // 10fps

            // Small delay to ensure canvas has content, then publish
            setTimeout(async () => {
                try {
                    await useMediaStore.getState().publishCanvasTrack(hiddenCanvas)
                } catch (err) {
                    console.warn('[MainGame] Failed to publish canvas track:', err)
                }
            }, 500)

            return () => clearInterval(intervalId)
        }
    }

    connect()
}, [room?.status, room?.id, playerId])
```

수정 후:
```typescript
// Connect to LiveKit when game starts playing
useEffect(() => {
    if (room?.status !== 'playing' || !room?.id || !playerId) return
    const ms = useMediaStore.getState()
    if (ms.isConnected || ms.isConnecting) return

    let cleanupFn: (() => void) | undefined

    const connect = async () => {
        await ms.connectToRoom(room.id, myAlias, 'player')

        // After connection, set up SVG-to-canvas streaming
        const svgEl = canvasWrapperRef.current?.querySelector('svg')
        const hiddenCanvas = hiddenCanvasRef.current
        if (svgEl && hiddenCanvas) {
            const ctx = hiddenCanvas.getContext('2d')
            if (!ctx) return

            // Double buffer: offscreen canvas to avoid blank frames during async image loading
            const offscreen = document.createElement('canvas')
            const offCtx = offscreen.getContext('2d')!

            let lastWidth = 0
            let lastHeight = 0
            let lastFrameTime = 0
            let rafId: number
            const FRAME_INTERVAL = 1000 / 30 // 30fps target

            // Pre-create reusable Image object to reduce GC pressure
            const img = new Image()
            let pendingBlobUrl: string | null = null

            img.onload = () => {
                // Draw to offscreen canvas first (never leaves main canvas blank)
                offCtx.clearRect(0, 0, offscreen.width, offscreen.height)
                offCtx.drawImage(img, 0, 0)

                // Copy offscreen → main canvas (atomic, no blank frame possible)
                ctx.clearRect(0, 0, hiddenCanvas.width, hiddenCanvas.height)
                ctx.drawImage(offscreen, 0, 0)

                // Cleanup blob URL after successful draw
                if (pendingBlobUrl) {
                    URL.revokeObjectURL(pendingBlobUrl)
                    pendingBlobUrl = null
                }
            }

            const renderLoop = (timestamp: number) => {
                rafId = requestAnimationFrame(renderLoop)

                // Throttle to ~30fps
                if (timestamp - lastFrameTime < FRAME_INTERVAL) return
                lastFrameTime = timestamp

                const rect = svgEl.getBoundingClientRect()
                const w = Math.round(rect.width)
                const h = Math.round(rect.height)

                // Only resize canvases when dimensions actually change
                if (w !== lastWidth || h !== lastHeight) {
                    hiddenCanvas.width = w
                    hiddenCanvas.height = h
                    offscreen.width = w
                    offscreen.height = h
                    lastWidth = w
                    lastHeight = h
                }

                // Serialize SVG and load as image
                const svgData = new XMLSerializer().serializeToString(svgEl)
                const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })

                // Cleanup previous pending blob if image hasn't loaded yet
                if (pendingBlobUrl) {
                    URL.revokeObjectURL(pendingBlobUrl)
                }
                pendingBlobUrl = URL.createObjectURL(blob)
                img.src = pendingBlobUrl
            }

            // Start render loop
            rafId = requestAnimationFrame(renderLoop)

            // Publish canvas track after initial content is ready
            setTimeout(async () => {
                try {
                    await useMediaStore.getState().publishCanvasTrack(hiddenCanvas)
                } catch (err) {
                    console.warn('[MainGame] Failed to publish canvas track:', err)
                }
            }, 500)

            // Store cleanup so useEffect can call it on unmount
            cleanupFn = () => {
                cancelAnimationFrame(rafId)
                if (pendingBlobUrl) URL.revokeObjectURL(pendingBlobUrl)
            }
        }
    }

    connect()

    return () => {
        cleanupFn?.()
    }
}, [room?.status, room?.id, playerId])
```

**변경 포인트 요약:**

| 이전 | 이후 | 효과 |
|------|------|------|
| `setInterval(100)` = 10fps | `requestAnimationFrame` + 30fps 스로틀 | 3배 부드러운 녹화 |
| 매 프레임 `canvas.width=` 리셋 | 크기 변경 시에만 리셋 | 불필요한 초기화 방지 |
| 직접 main canvas에 그리기 | offscreen → main 복사 | 빈 프레임 방지 |
| 매번 `new Image()` 생성 | 재사용 Image 객체 | GC 부하 감소 |
| blob URL 누수 가능 | 명시적 정리 | 메모리 누수 방지 |
| async cleanup 무시됨 | `cleanupFn` 변수로 capture | 언마운트 시 정리 보장 |

- [ ] **Step 2: 수동 테스트**

1. 태블릿에서 게임 접속
2. 빠르게 선을 여러 개 그리기
3. 브라우저 DevTools → Performance 탭에서:
   - `requestAnimationFrame` 콜백이 ~33ms 간격(30fps)으로 호출되는지 확인
   - 메인 스레드 blocking이 없는지 확인
4. hidden canvas (`document.querySelector('canvas')`)를 검사하여 빈 프레임 없이 연속 렌더링되는지 확인

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/room/MainGame.tsx
git commit -m "fix: rewrite canvas capture to 30fps rAF with double buffering"
```

---

## Task 3: Egress 서비스 리소스 제한 추가

**문제:** 5팀 동시 운영 시 20개 Egress 녹화가 VPS 리소스를 전부 소비하여 LiveKit SFU까지 영향. Docker Compose에 리소스 제한 없음.

**해결:** Egress 서비스에 CPU/메모리 제한을 추가하여 SFU 서비스 안정성 보장.

**Files:**
- Modify: `services/docker-compose.yml:18-29` (egress 서비스 설정)

**Docker Compose 호환성 참고:** `deploy.resources` 섹션은 Docker Compose v2 플러그인(`docker compose` CLI)에서는 Swarm 없이도 지원됨. 배포 전 VPS에서 `docker compose version` 으로 v2 이상인지 확인 필요. 만약 v1(`docker-compose` 바이너리)을 사용 중이라면 `--compatibility` 플래그 필요: `docker-compose --compatibility up -d`.

- [ ] **Step 1: VPS Docker Compose 버전 확인**

```bash
ssh vps2 "docker compose version"
```

- v2.x 이상이면 `deploy.resources` 그대로 사용 가능
- v1.x면 `docker-compose --compatibility up -d`로 배포하거나, v2 업그레이드 권장

- [ ] **Step 2: Egress 서비스에 리소스 제한 추가**

`docker-compose.yml`의 egress 서비스 블록(18-29행) 수정:

기존:
```yaml
  egress:
    image: livekit/egress:latest
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - ./egress/config.yaml:/etc/egress.yaml
      - recordings:/recordings
    cap_add:
      - SYS_ADMIN
    networks:
      - livekit-net
```

수정 후:
```yaml
  egress:
    image: livekit/egress:latest
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - ./egress/config.yaml:/etc/egress.yaml
      - recordings:/recordings
    cap_add:
      - SYS_ADMIN
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
        reservations:
          cpus: '2'
          memory: 4G
    networks:
      - livekit-net
```

> **참고:** 실제 VPS 스펙에 따라 조정 필요. 위 값은 8코어/16GB VPS 기준으로, Egress에 절반을 할당하고 나머지를 SFU/CoTURN에 보장.

- [ ] **Step 3: LiveKit SFU에도 최소 리소스 보장 추가**

livekit 서비스 블록(4-16행)에 리소스 예약 추가:

기존:
```yaml
  livekit:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
      - "50000-50200:50000-50200/udp"
    volumes:
      - ./livekit/config.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
    networks:
      - livekit-net
```

수정 후:
```yaml
  livekit:
    image: livekit/livekit-server:latest
    restart: unless-stopped
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
      - "50000-50200:50000-50200/udp"
    volumes:
      - ./livekit/config.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
    deploy:
      resources:
        reservations:
          cpus: '2'
          memory: 2G
    networks:
      - livekit-net
```

이렇게 하면 Egress가 리소스를 과도하게 사용해도 SFU에 최소 2코어/2GB가 보장됨.

- [ ] **Step 4: VPS에 배포 후 확인**

```bash
ssh vps2 "cd ~/livekit && docker compose up -d"
ssh vps2 "docker stats --no-stream"  # 리소스 사용량 확인
```

- [ ] **Step 5: Commit**

```bash
git add services/docker-compose.yml
git commit -m "infra: add resource limits to egress service for multi-team stability"
```

---

## 실행 순서

1. **Task 1** → Task 2 → Task 3 순서로 진행 (의존성 없으므로 병렬 가능하나, Task 1+2는 같은 영역이므로 순차 권장)
2. Task 1+2 완료 후 로컬에서 그리기 + hidden canvas 렌더링 수동 테스트
3. Task 3은 VPS 배포 시 적용

## 예상 영향

| 항목 | 이전 | 이후 |
|------|------|------|
| 이미지 오버레이 녹화 | 누락됨 | 정상 캡처 |
| 녹화 프레임레이트 | 10fps (끊김) | 30fps (부드러움) |
| 빈 프레임 발생 | 가능 (경쟁 조건) | 불가 (더블 버퍼링) |
| useEffect cleanup | 동작 안 함 (async 버그) | 정상 동작 |
| 5팀 동시 영상 품질 | SFU 불안정 가능 | SFU 리소스 보장 |
| 클라이언트 성능 영향 | 없음 | 없음 (rAF는 브라우저 최적화됨) |

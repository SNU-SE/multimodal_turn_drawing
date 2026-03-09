import { useRef, useEffect, useState, useCallback } from "react"
import { getStroke } from "perfect-freehand"

interface Point {
    x: number
    y: number
    pressure?: number
}

interface Stroke {
    id?: string
    points: Point[]
    color: string
    width: number
}

export interface CanvasImage {
    url: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
}

interface FreehandCanvasProps {
    color?: string
    width?: number
    disabled?: boolean
    initialStrokes?: Stroke[]
    partnerStroke?: Stroke | null
    onStrokeUpdate?: (stroke: Stroke) => void
    onStrokeEnd?: (stroke: Stroke) => void
    // Eraser
    eraserMode?: boolean
    onEraseStroke?: (strokeId: string) => void
    // Image overlay
    canvasImage?: CanvasImage | null
    imageEditMode?: boolean
    onImageUpdate?: (image: CanvasImage) => void
    onImageUpdateEnd?: (image: CanvasImage) => void
}

function getSvgPathFromStroke(stroke: number[][]) {
    if (!stroke.length) return ""
    const d = stroke.reduce(
        (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length]
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
            return acc
        },
        ["M", ...stroke[0], "Q"]
    )
    d.push("Z")
    return d.join(" ")
}

export function FreehandCanvas({
    color = "#F45B69",
    width = 8,
    disabled = false,
    initialStrokes = [],
    partnerStroke = null,
    onStrokeUpdate,
    onStrokeEnd,
    eraserMode = false,
    onEraseStroke,
    canvasImage = null,
    imageEditMode = false,
    onImageUpdate,
    onImageUpdateEnd,
}: FreehandCanvasProps) {
    const [currentPoints, setCurrentPoints] = useState<Point[]>([])
    const svgRef = useRef<SVGSVGElement>(null)
    const lastUpdateTimeRef = useRef(0)

    // Eraser: track which stroke IDs have been erased during this drag
    const erasedDuringDragRef = useRef<Set<string>>(new Set())
    const isErasingRef = useRef(false)

    // Palm rejection: when a pen is detected, ignore touch input
    const penDetectedRef = useRef(false)

    // Image drag/resize state
    const imageDragRef = useRef<{
        type: 'move' | 'resize'
        startX: number
        startY: number
        origImage: CanvasImage
    } | null>(null)

    // ── Hit-test for eraser: check SVG elements at point ──
    const eraseAtPoint = useCallback((clientX: number, clientY: number) => {
        if (!svgRef.current || !onEraseStroke) return

        // Check a small area around the touch point (8px radius)
        const offsets = [
            [0, 0], [-6, 0], [6, 0], [0, -6], [0, 6],
            [-4, -4], [4, -4], [-4, 4], [4, 4]
        ]
        for (const [dx, dy] of offsets) {
            const el = document.elementFromPoint(clientX + dx, clientY + dy)
            if (el && el instanceof SVGPathElement) {
                const strokeId = el.getAttribute('data-stroke-id')
                if (strokeId && !erasedDuringDragRef.current.has(strokeId)) {
                    erasedDuringDragRef.current.add(strokeId)
                    onEraseStroke(strokeId)
                }
            }
        }
    }, [onEraseStroke])

    // ── Pointer handlers ──
    const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled) return

        // Palm rejection: pen takes priority over touch
        if (e.pointerType === 'pen') {
            penDetectedRef.current = true
        }
        if (e.pointerType === 'touch' && penDetectedRef.current) {
            return // Ignore touch when pen is active
        }

        // Image edit mode: handle image drag/resize
        if (imageEditMode && canvasImage) {
            const target = e.target as SVGElement
            const bounds = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - bounds.left
            const py = e.clientY - bounds.top

            if (target.getAttribute('data-role') === 'resize-handle') {
                e.currentTarget.setPointerCapture(e.pointerId)
                imageDragRef.current = {
                    type: 'resize',
                    startX: px,
                    startY: py,
                    origImage: { ...canvasImage }
                }
                return
            }

            // Check if click is on the image area
            if (
                px >= canvasImage.x && px <= canvasImage.x + canvasImage.width &&
                py >= canvasImage.y && py <= canvasImage.y + canvasImage.height
            ) {
                e.currentTarget.setPointerCapture(e.pointerId)
                imageDragRef.current = {
                    type: 'move',
                    startX: px,
                    startY: py,
                    origImage: { ...canvasImage }
                }
                return
            }
        }

        if (eraserMode) {
            e.currentTarget.setPointerCapture(e.pointerId)
            isErasingRef.current = true
            erasedDuringDragRef.current.clear()
            eraseAtPoint(e.clientX, e.clientY)
            return
        }

        // Normal drawing
        e.currentTarget.setPointerCapture(e.pointerId)
        const bounds = e.currentTarget.getBoundingClientRect()
        setCurrentPoints([{
            x: e.clientX - bounds.left,
            y: e.clientY - bounds.top,
            pressure: e.pressure
        }])
    }

    const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled) return
        if (e.pointerType === 'touch' && penDetectedRef.current) return

        // Image drag/resize
        if (imageDragRef.current && canvasImage && onImageUpdate) {
            const bounds = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - bounds.left
            const py = e.clientY - bounds.top
            const { type, startX, startY, origImage } = imageDragRef.current

            if (type === 'move') {
                const dx = px - startX
                const dy = py - startY
                onImageUpdate({
                    ...origImage,
                    x: origImage.x + dx,
                    y: origImage.y + dy
                })
            } else {
                // Resize keeping aspect ratio
                const dx = px - startX
                const aspect = origImage.width / origImage.height
                const newWidth = Math.max(50, origImage.width + dx)
                const newHeight = newWidth / aspect
                onImageUpdate({
                    ...origImage,
                    width: newWidth,
                    height: newHeight
                })
            }
            return
        }

        if (eraserMode && isErasingRef.current) {
            eraseAtPoint(e.clientX, e.clientY)
            return
        }

        if (currentPoints.length === 0) return
        const bounds = e.currentTarget.getBoundingClientRect()
        const newPoint = { x: e.clientX - bounds.left, y: e.clientY - bounds.top, pressure: e.pressure }

        setCurrentPoints(prev => {
            const next = [...prev, newPoint]
            const now = Date.now()
            if (now - lastUpdateTimeRef.current > 100) {
                lastUpdateTimeRef.current = now
                onStrokeUpdate?.({ points: next, color, width })
            }
            return next
        })
    }

    const handlePointerUp = () => {
        if (disabled) return

        // Image drag/resize end
        if (imageDragRef.current && canvasImage && onImageUpdateEnd) {
            onImageUpdateEnd(canvasImage)
            imageDragRef.current = null
            return
        }
        imageDragRef.current = null

        if (eraserMode) {
            isErasingRef.current = false
            erasedDuringDragRef.current.clear()
            return
        }

        if (currentPoints.length === 0) return
        const newStroke: Stroke = { points: currentPoints, color, width }
        setCurrentPoints([])
        onStrokeEnd?.(newStroke)
    }

    useEffect(() => {
        if (disabled) setCurrentPoints([])
    }, [disabled])

    const currentStrokePath = currentPoints.length > 0
        ? getSvgPathFromStroke(getStroke(currentPoints, {
            size: width,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
        }))
        : null

    const cursorClass = disabled
        ? 'opacity-90'
        : eraserMode
            ? 'cursor-pointer'
            : imageEditMode
                ? 'cursor-move'
                : 'cursor-crosshair'

    return (
        <div className={`w-full h-full overflow-hidden select-none ${cursorClass}`} style={{ WebkitTouchCallout: 'none' }}>
            <svg
                ref={svgRef}
                className="w-full h-full touch-none bg-white"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                {/* Image overlay — behind all strokes */}
                {canvasImage && canvasImage.visible && (
                    <image
                        href={canvasImage.url}
                        x={canvasImage.x}
                        y={canvasImage.y}
                        width={canvasImage.width}
                        height={canvasImage.height}
                        preserveAspectRatio="xMidYMid meet"
                        style={{ pointerEvents: 'none' }}
                    />
                )}

                {/* Image edit mode: border + resize handle */}
                {imageEditMode && canvasImage && canvasImage.visible && (
                    <>
                        <rect
                            x={canvasImage.x}
                            y={canvasImage.y}
                            width={canvasImage.width}
                            height={canvasImage.height}
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                            style={{ pointerEvents: 'none' }}
                        />
                        <rect
                            data-role="resize-handle"
                            x={canvasImage.x + canvasImage.width - 10}
                            y={canvasImage.y + canvasImage.height - 10}
                            width={20}
                            height={20}
                            rx={3}
                            fill="#3b82f6"
                            stroke="white"
                            strokeWidth={2}
                            style={{ cursor: 'nwse-resize' }}
                        />
                    </>
                )}

                {/* Committed strokes */}
                {initialStrokes.map((stroke, index) => {
                    const rawStroke = getStroke(stroke.points, {
                        size: stroke.width,
                        thinning: 0.5,
                        smoothing: 0.5,
                        streamline: 0.5,
                    })
                    const pathData = getSvgPathFromStroke(rawStroke)
                    return (
                        <path
                            key={stroke.id || index}
                            d={pathData}
                            fill={stroke.color}
                            data-stroke-id={stroke.id || undefined}
                            style={{
                                pointerEvents: eraserMode ? 'visiblePainted' : 'none'
                            }}
                        />
                    )
                })}

                {/* Partner's active stroke */}
                {partnerStroke && (() => {
                    const rawStroke = getStroke(partnerStroke.points, {
                        size: partnerStroke.width,
                        thinning: 0.5,
                        smoothing: 0.5,
                        streamline: 0.5,
                    })
                    const pathData = getSvgPathFromStroke(rawStroke)
                    return <path d={pathData} fill={partnerStroke.color} opacity={0.5} style={{ pointerEvents: 'none' }} />
                })()}

                {/* In-progress stroke */}
                {currentStrokePath && (
                    <path d={currentStrokePath} fill={color} opacity={0.85} style={{ pointerEvents: 'none' }} />
                )}
            </svg>
        </div>
    )
}

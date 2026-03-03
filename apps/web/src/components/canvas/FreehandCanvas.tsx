import { useRef, useEffect, useState } from "react"
import { getStroke } from "perfect-freehand"

interface Point {
    x: number
    y: number
    pressure?: number
}

interface Stroke {
    points: Point[]
    color: string
    width: number
}

interface FreehandCanvasProps {
    color?: string
    width?: number
    disabled?: boolean
    // strokes is the single source of truth from the store
    initialStrokes?: Stroke[]
    onStrokeEnd?: (stroke: Stroke) => void
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

function renderStroke(stroke: Stroke, index: number) {
    const rawStroke = getStroke(stroke.points, {
        size: stroke.width,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
    })
    const pathData = getSvgPathFromStroke(rawStroke)
    return <path key={index} d={pathData} fill={stroke.color} />
}

export function FreehandCanvas({
    color = "#F45B69",
    width = 8,
    disabled = false,
    initialStrokes = [],
    onStrokeEnd,
}: FreehandCanvasProps) {
    // currentPoints: the stroke currently being drawn (local, not in store)
    const [currentPoints, setCurrentPoints] = useState<Point[]>([])
    const svgRef = useRef<SVGSVGElement>(null)

    const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const bounds = e.currentTarget.getBoundingClientRect()
        setCurrentPoints([{
            x: e.clientX - bounds.left,
            y: e.clientY - bounds.top,
            pressure: e.pressure
        }])
    }

    const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled || currentPoints.length === 0) return
        const bounds = e.currentTarget.getBoundingClientRect()
        setCurrentPoints(prev => [
            ...prev,
            { x: e.clientX - bounds.left, y: e.clientY - bounds.top, pressure: e.pressure }
        ])
    }

    const handlePointerUp = () => {
        if (disabled || currentPoints.length === 0) return
        const newStroke: Stroke = { points: currentPoints, color, width }
        setCurrentPoints([])
        onStrokeEnd?.(newStroke)
    }

    // Clear currentPoints when disabled changes (e.g. turn switches)
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

    return (
        <div className={`w-full h-full overflow-hidden ${disabled ? 'opacity-90' : 'cursor-crosshair'}`}>
            <svg
                ref={svgRef}
                className="w-full h-full touch-none bg-white"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                {/* Committed strokes from store — re-renders whenever initialStrokes reference changes */}
                {initialStrokes.map(renderStroke)}

                {/* In-progress stroke (local only, for immediate feedback) */}
                {currentStrokePath && (
                    <path d={currentStrokePath} fill={color} opacity={0.85} />
                )}
            </svg>
        </div>
    )
}

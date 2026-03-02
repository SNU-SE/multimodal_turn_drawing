import { useState, useEffect } from "react"
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
    initialStrokes?: Stroke[]
    onStrokeEnd?: (stroke: Stroke) => void
    onClear?: () => void
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
    onStrokeEnd,
}: FreehandCanvasProps) {
    const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes)
    const [currentPoints, setCurrentPoints] = useState<Point[]>([])

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
        setCurrentPoints((prev) => [
            ...prev,
            { x: e.clientX - bounds.left, y: e.clientY - bounds.top, pressure: e.pressure }
        ])
    }

    const handlePointerUp = () => {
        if (disabled || currentPoints.length === 0) return
        const newStroke = { points: currentPoints, color, width }
        setStrokes((prev) => [...prev, newStroke])
        setCurrentPoints([])
        onStrokeEnd?.(newStroke)
    }

    useEffect(() => {
        setStrokes(initialStrokes)
    }, [initialStrokes])

    const renderStroke = (stroke: Stroke, index: number) => {
        const rawStroke = getStroke(stroke.points, {
            size: stroke.width,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
        })
        const pathData = getSvgPathFromStroke(rawStroke)
        return <path key={index} d={pathData} fill={stroke.color} />
    }

    return (
        <div className={`w-full h-full border rounded-md bg-white overflow-hidden ${disabled ? 'opacity-80' : 'cursor-crosshair'}`}>
            <svg
                className="w-full h-full touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                {strokes.map(renderStroke)}
                {currentPoints.length > 0 && (
                    <path
                        d={getSvgPathFromStroke(
                            getStroke(currentPoints, {
                                size: width,
                                thinning: 0.5,
                                smoothing: 0.5,
                                streamline: 0.5,
                            })
                        )}
                        fill={color}
                    />
                )}
            </svg>
        </div>
    )
}

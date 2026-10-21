import { useEffect, useId, useRef, useState } from 'react'

// 好感水滴：水位 = 好感度。數值改變時起漣漪、浮出 +N
export default function Droplet({ value, size = 34, showDelta = true }: { value: number; size?: number; showDelta?: boolean }) {
  const id = useId().replace(/:/g, '')
  const prev = useRef(value)
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null)

  useEffect(() => {
    const d = value - prev.current
    prev.current = value
    if (d !== 0 && showDelta) setDelta({ n: d, key: Date.now() })
  }, [value, showDelta])

  useEffect(() => {
    if (!delta) return
    const t = setTimeout(() => setDelta(null), 1600)
    return () => clearTimeout(t)
  }, [delta])

  const level = Math.max(0, Math.min(100, value))
  // 水滴高 32，可裝水的區域約從 y=3 到 y=30
  const y = 30 - (27 * level) / 100

  return (
    <span className={`droplet ${delta ? 'stir' : ''}`} style={{ width: size * 0.75, height: size }} aria-label={`好感 ${level}`}>
      <svg viewBox="0 0 24 32" width={size * 0.75} height={size} aria-hidden="true">
        <defs>
          <clipPath id={`d${id}`}>
            <path d="M12 1.6C16.6 8 21 13 21 19.6a9 9 0 01-18 0C3 13 7.4 8 12 1.6z" />
          </clipPath>
        </defs>
        <path className="droplet-shell" d="M12 1.6C16.6 8 21 13 21 19.6a9 9 0 01-18 0C3 13 7.4 8 12 1.6z" />
        <g clipPath={`url(#d${id})`}>
          <g className="droplet-water" style={{ transform: `translateY(${y}px)` }}>
            <path className="droplet-wave" d="M-24 0q6-2.2 12 0t12 0 12 0 12 0 12 0V40H-24z" />
          </g>
        </g>
        <path className="droplet-shine" d="M8.2 13.5c-.9 1.6-1.4 3.3-1.4 4.9" />
      </svg>
      {delta && (
        <span key={delta.key} className={`droplet-delta ${delta.n > 0 ? 'up' : 'down'}`}>
          {delta.n > 0 ? `+${delta.n}` : delta.n}
        </span>
      )}
    </span>
  )
}

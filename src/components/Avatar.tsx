import type { Character } from '../types'
import { fallbackArt } from '../look'

// 頭像：有上傳就用頭像，其次用立繪，都沒有就用名字的色彩與第一個字
export default function Avatar({ c, size = 40, name }: { c?: Character; size?: number; name?: string }) {
  const label = c?.name ?? name ?? '?'
  const src = c?.avatar || c?.portrait
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundImage: src ? `url(${src})` : fallbackArt(label),
      }}
      role="img"
      aria-label={label}
    >
      {!src && label.slice(0, 1)}
    </span>
  )
}

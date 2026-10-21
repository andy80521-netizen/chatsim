// 視覺輔助：角色沒有圖片時，用名字算出一組穩定的柔和色彩

export function hueOf(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return h
}

// 沒有立繪時的替代背景：兩個柔光圓 + 名字色相
export function fallbackArt(name: string): string {
  const h = hueOf(name || '?')
  const h2 = (h + 38) % 360
  return [
    `radial-gradient(120% 90% at 20% 15%, hsl(${h} 70% 82% / 0.95), transparent 60%)`,
    `radial-gradient(110% 80% at 85% 90%, hsl(${h2} 65% 72% / 0.9), transparent 62%)`,
    `linear-gradient(160deg, hsl(${h} 45% 88%), hsl(${h2} 40% 70%))`,
  ].join(',')
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = 60_000
  if (diff < min) return '剛剛'
  if (diff < 60 * min) return `${Math.floor(diff / min)} 分鐘前`
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} 小時前`
  const d = new Date(ts)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

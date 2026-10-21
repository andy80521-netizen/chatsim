// 圖片上傳後在瀏覽器裡縮圖、轉成 WebP data URL。
// Firestore 單一文件上限 1 MB，三張圖加起來控制在約 500 KB 內。

export type ImageKind = 'avatar' | 'portrait' | 'background'

const SPEC: Record<ImageKind, { w: number; h: number; quality: number; maxBytes: number }> = {
  avatar: { w: 256, h: 256, quality: 0.82, maxBytes: 45_000 },
  portrait: { w: 720, h: 960, quality: 0.8, maxBytes: 190_000 },
  background: { w: 1080, h: 1440, quality: 0.72, maxBytes: 260_000 },
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取這張圖片，請換一張 JPG、PNG 或 WebP'))
    }
    img.src = url
  })
}

// 依目標比例置中裁切（cover），再逐步降低品質直到符合大小
export async function compressImage(file: File, kind: ImageKind): Promise<string> {
  const spec = SPEC[kind]
  const img = await loadImage(file)

  const targetRatio = spec.w / spec.h
  const srcRatio = img.naturalWidth / img.naturalHeight
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  if (srcRatio > targetRatio) sw = sh * targetRatio
  else sh = sw / targetRatio
  const sx = (img.naturalWidth - sw) / 2
  const sy = (img.naturalHeight - sh) / 2

  const scale = Math.min(1, spec.w / sw)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('瀏覽器不支援圖片處理')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

  let q = spec.quality
  let out = canvas.toDataURL('image/webp', q)
  // Safari 舊版不支援 WebP 輸出時會回傳 PNG，改用 JPEG
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', q)
  const type = out.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  while (out.length * 0.75 > spec.maxBytes && q > 0.4) {
    q -= 0.08
    out = canvas.toDataURL(type, q)
  }
  return out
}

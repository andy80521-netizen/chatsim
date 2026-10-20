// 語音朗讀（TTS）與語音輸入（STT），使用瀏覽器內建 Web Speech API，不需額外 API

export function speak(text: string, lang: string, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) {
    onEnd?.()
    return
  }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Recognizer = any

export function createRecognizer(lang: string, onResult: (text: string) => void, onEnd: () => void): Recognizer | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = lang
  r.interimResults = false
  r.continuous = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.onresult = (e: any) => onResult(e.results[0][0].transcript)
  r.onend = onEnd
  r.onerror = onEnd
  return r
}

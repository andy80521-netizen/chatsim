import type { Character, Fragment, Settings } from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
export const META = '###META###'

export interface Turn {
  role: 'user' | 'model'
  text: string
}

// Gemini 要求：以 user 開頭、不能是空的。相鄰同角色的訊息合併。
export function mergeTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = []
  for (const t of turns) {
    if (!t.text.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === t.role) last.text += '\n' + t.text
    else out.push({ ...t })
  }
  while (out.length && out[0].role === 'model') out.shift()
  if (!out.length) out.push({ role: 'user', text: '（對話開始）' })
  return out
}

export interface PromptArgs {
  speaker: Character
  members: Character[]
  memory: string
  pinned: string
  affection: number
  stage: string
  unlocked: Fragment[]
  single: boolean
}

export function buildSystemPrompt(a: PromptArgs): string {
  const c = a.speaker
  const user = c.userName || '使用者'

  const head = a.single
    ? `你正在扮演「${c.name}」，和使用者「${user}」進行文字聊天。`
    : `這是一個群組聊天。成員有：${a.members.map((m) => m.name).join('、')}，以及使用者「${user}」。你只扮演「${c.name}」，只代表自己說話，不要替其他成員或使用者發言，句首不要加自己的名字。其他成員的發言會以「名字：內容」的形式出現。`

  const parts = [head, `【角色設定】\n${c.persona || '（未設定，請自然、友善地聊天）'}`]

  if (c.greeting) parts.push(`【你的開場白，僅供掌握語氣】\n${c.greeting}`)

  if (a.single) {
    parts.push(`【目前關係】階段「${a.stage}」，好感 ${a.affection}/100。請讓親密程度符合這個階段，不要突然跳級。`)
    if (a.unlocked.length) {
      parts.push(
        `【你已經向對方敞開的過去（適當時機自然提起，不要一次全說）】\n` +
          a.unlocked.map((f) => `- ${f.title}：${f.content}`).join('\n'),
      )
    }
  }

  if (a.pinned.trim()) parts.push(`【使用者要你記住的事】\n${a.pinned.trim()}`)
  if (a.memory) parts.push(`【你記得的過往對話摘要】\n${a.memory}`)

  parts.push('【規則】以角色身分自然對話；回覆口語、簡短（通常 1–4 句）；不要重複使用者的話。')

  if (a.single) {
    parts.push(
      `【輸出格式】先寫對話內容。接著另起一行輸出 ${META}，再接一行 JSON：` +
        `{"affection": 整數, "mood": "兩三個字的心情"${c.innerVoice ? ', "inner": "只有玩家看得到的內心獨白，一兩句"' : ''}}。` +
        `affection 是這一輪的好感變化（-3 到 5；多數時候 0 到 2，劇情有明確觸動才給高）。對話內容中不要出現 JSON 或這些標記。`,
    )
  }

  return parts.join('\n\n')
}

// 串流時隱藏還沒收完的 ###META### 前綴
export function displayText(raw: string): string {
  const i = raw.indexOf(META)
  const text = i >= 0 ? raw.slice(0, i) : raw.replace(/#{1,3}[A-Z]{0,4}#{0,3}$/, '')
  return text.trim()
}

export function splitReply(raw: string) {
  const i = raw.indexOf(META)
  return {
    text: (i >= 0 ? raw.slice(0, i) : raw).trim(),
    metaRaw: i >= 0 ? raw.slice(i + META.length).trim() : '',
  }
}

export function parseMeta(metaRaw: string): { affection: number; mood?: string; inner?: string } {
  try {
    const m = metaRaw.match(/\{[\s\S]*\}/)
    if (!m) return { affection: 0 }
    const o = JSON.parse(m[0])
    const a = Math.round(Number(o.affection))
    return {
      affection: Number.isFinite(a) ? Math.max(-3, Math.min(5, a)) : 0,
      mood: typeof o.mood === 'string' ? o.mood.slice(0, 12) : undefined,
      inner: typeof o.inner === 'string' && o.inner.trim() ? o.inner.trim() : undefined,
    }
  } catch {
    return { affection: 0 }
  }
}

interface StreamArgs {
  settings: Settings
  system: string
  turns: Turn[]
  signal?: AbortSignal
  onToken: (t: string) => void
}

export async function streamModel({ settings, system, turns, signal, onToken }: StreamArgs) {
  if (!settings.apiKey) throw new Error('請先到首頁「設定」填入 Gemini API Key')

  const res = await fetch(
    `${BASE}/${settings.model}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      }),
    },
  )

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API 錯誤 ${res.status}：${detail.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json) continue
      try {
        const data = JSON.parse(json)
        const text: string | undefined = data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? '')
          .join('')
        if (text) onToken(text)
      } catch {
        /* 忽略不完整的 chunk */
      }
    }
  }
}

async function generateText(settings: Settings, prompt: string, json = false): Promise<string> {
  if (!settings.apiKey) throw new Error('請先到首頁「設定」填入 Gemini API Key')
  const res = await fetch(`${BASE}/${settings.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: json ? { responseMimeType: 'application/json' } : undefined,
    }),
  })
  if (!res.ok) throw new Error(`API 錯誤 ${res.status}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
}

// 把舊對話併進長期記憶
export async function summarizeChunk(settings: Settings, prevMemory: string, lines: string[]): Promise<string> {
  const prompt =
    `請把「既有記憶」與「新對話」合併，整理成不超過 300 字的繁體中文記憶筆記，` +
    `保留：使用者的個人資訊與偏好、雙方約定、重要事件、關係進展與目前氣氛。只輸出筆記本身。\n\n` +
    `【既有記憶】\n${prevMemory || '（無）'}\n\n【新對話】\n${lines.join('\n')}`
  return (await generateText(settings, prompt)).trim() || prevMemory
}

export interface CharDraft {
  name: string
  userName: string
  persona: string
  greeting: string
  fragments: { title: string; content: string; unlockAt: number }[]
}

// 一句話想法 → 完整角色卡
export async function generateCharacter(settings: Settings, idea: string): Promise<CharDraft> {
  const prompt =
    `請根據這個想法設計一個聊天角色，只輸出 JSON，繁體中文，格式：\n` +
    `{"name":"角色暱稱","userName":"角色稱呼使用者的方式","persona":"性格、口吻、背景、與使用者的關係，150 字內","greeting":"角色的第一句話，口語","fragments":[{"title":"回憶標題","content":"角色過去的一段經歷，60 字內","unlockAt":15},{"title":"…","content":"…","unlockAt":40},{"title":"…","content":"…","unlockAt":70}]}\n\n` +
    `想法：${idea}`
  const raw = await generateText(settings, prompt, true)
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('AI 沒有回傳可用的角色資料')
  return JSON.parse(m[0]) as CharDraft
}

// 回憶碎片：好感度達到 unlockAt 後解鎖，解鎖後角色才會在對話中提到
export interface Fragment {
  id: string
  title: string
  content: string
  unlockAt: number
}

export interface Character {
  id: string
  name: string // 角色暱稱
  userName: string // 角色怎麼稱呼你
  persona: string // 性格、口吻、背景
  greeting: string // 前書：角色的第一句話
  innerVoice: boolean // 是否顯示內心戲
  fragments: Fragment[]
  createdAt: number
}

// 對話樹的節點：每則訊息都指向父節點，分支 = 同一父節點有多個子節點
export interface TNode {
  id: string
  parentId: string | null
  role: 'user' | 'assistant'
  content: string
  ts: number
  speakerId?: string // 群組對話時是誰說的
  inner?: string // 內心戲
  mood?: string
  affection?: number // 這則之後的累計好感（分支各自獨立）
  memory?: string // 摘要記憶：涵蓋到這則為止的所有對話（分支各自獨立）
}

export interface Conversation {
  id: string
  title: string
  characterIds: string[] // 1 個 = 單人；2 個以上 = 群組
  nodes: Record<string, TNode>
  leafId: string | null // 目前所在位置
  pinned: string // 使用者手動寫的「請記住」
  createdAt: number
  updatedAt: number
}

export interface Settings {
  apiKey: string
  model: string
  ttsAuto: boolean // 角色回覆後自動朗讀
  lang: string // 語音語言
  greetAfterHours: number // 隔多久回來時角色主動打招呼，0 = 關閉
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gemini-2.5-flash',
  ttsAuto: false,
  lang: 'zh-TW',
  greetAfterHours: 0,
}

export type StatKey =
  | 'messages'
  | 'regens'
  | 'rewinds'
  | 'branches'
  | 'edits'
  | 'tts'
  | 'groupConvs'
  | 'maxAffection'
  | 'fragments'

export type Stats = Record<StatKey, number>

export const EMPTY_STATS: Stats = {
  messages: 0,
  regens: 0,
  rewinds: 0,
  branches: 0,
  edits: 0,
  tts: 0,
  groupConvs: 0,
  maxAffection: 0,
  fragments: 0,
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

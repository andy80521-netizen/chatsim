import { Character, uid } from './types'

export type CharForm = Omit<Character, 'id' | 'createdAt'>

export const blankForm = (): CharForm => ({
  name: '',
  userName: '',
  persona: '',
  greeting: '',
  innerVoice: false,
  fragments: [],
})

export function normalizeCharacter(c: Partial<Character>): Character {
  return {
    id: uid(),
    name: String(c.name ?? '').trim() || '未命名',
    userName: String(c.userName ?? ''),
    persona: String(c.persona ?? ''),
    greeting: String(c.greeting ?? ''),
    innerVoice: Boolean(c.innerVoice),
    fragments: (c.fragments ?? []).map((f) => ({
      id: uid(),
      title: String(f.title ?? ''),
      content: String(f.content ?? ''),
      unlockAt: Number(f.unlockAt) || 0,
    })),
    createdAt: Date.now(),
  }
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// 角色模板檔：可分享給別人，對方匯入即可使用
export function exportCharacter(c: Character) {
  downloadJSON(`${c.name}.chatsim.json`, {
    chatsim: 'character',
    version: 1,
    character: {
      name: c.name,
      userName: c.userName,
      persona: c.persona,
      greeting: c.greeting,
      innerVoice: c.innerVoice,
      fragments: c.fragments.map((f) => ({ title: f.title, content: f.content, unlockAt: f.unlockAt })),
    },
  })
}

export function parseCharacterFile(text: string): Character[] {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : [data]
  return list.map((x) => normalizeCharacter(x?.character ?? x))
}

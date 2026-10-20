import type { Stats } from './types'

export interface Achievement {
  id: string
  title: string
  desc: string
  test: (s: Stats, x: { characters: number }) => boolean
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', title: '初次開口', desc: '送出第一則訊息', test: (s) => s.messages >= 1 },
  { id: 'chatty', title: '話匣子', desc: '累計送出 100 則訊息', test: (s) => s.messages >= 100 },
  { id: 'ice', title: '破冰', desc: '好感度達到 10', test: (s) => s.maxAffection >= 10 },
  { id: 'spark', title: '心動時刻', desc: '好感度達到 55', test: (s) => s.maxAffection >= 55 },
  { id: 'bond', title: '羈絆', desc: '好感度達到 80', test: (s) => s.maxAffection >= 80 },
  { id: 'fragment', title: '揭開過去', desc: '解鎖第一個回憶碎片', test: (s) => s.fragments >= 1 },
  { id: 'rewind', title: '時光倒流', desc: '回到某個節點重新選擇', test: (s) => s.rewinds >= 1 },
  { id: 'multiverse', title: '平行世界', desc: '累計產生 3 條分支', test: (s) => s.branches >= 3 },
  { id: 'picky', title: '反覆斟酌', desc: '重新生成 5 次回覆', test: (s) => s.regens >= 5 },
  { id: 'editor', title: '改寫現實', desc: '編輯訊息 3 次', test: (s) => s.edits >= 3 },
  { id: 'voice', title: '聲音相伴', desc: '使用語音朗讀', test: (s) => s.tts >= 1 },
  { id: 'group', title: '熱鬧起來', desc: '建立一個群組對話', test: (s) => s.groupConvs >= 1 },
  { id: 'collector', title: '角色收藏家', desc: '擁有 3 個角色', test: (_s, x) => x.characters >= 3 },
]

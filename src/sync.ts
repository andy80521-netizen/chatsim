import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Character, Conversation, Stats } from './types'

// 移除 undefined 欄位，避免 Firestore 報錯
function cleanForFirestore<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(cleanForFirestore) as unknown as T
  const res: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      res[k] = cleanForFirestore(v)
    }
  }
  return res as T
}

// 防抖計時器
const convTimers = new Map<string, number>()
let statsTimer: number | null = null
let achvTimer: number | null = null

// 單一對話寫入（防抖 600ms，避免連續操作造成高頻寫入）
export function debouncedSaveConv(uid: string, conv: Conversation, delay = 600) {
  const existing = convTimers.get(conv.id)
  if (existing) window.clearTimeout(existing)

  const timer = window.setTimeout(async () => {
    convTimers.delete(conv.id)
    try {
      const ref = doc(db, 'users', uid, 'convs', conv.id)
      await setDoc(ref, cleanForFirestore(conv))
    } catch (e) {
      console.error('儲存對話到雲端失敗：', e)
    }
  }, delay)

  convTimers.set(conv.id, timer)
}

// 刪除雲端對話
export async function deleteConvFromCloud(uid: string, convId: string) {
  const existing = convTimers.get(convId)
  if (existing) {
    window.clearTimeout(existing)
    convTimers.delete(convId)
  }
  try {
    const ref = doc(db, 'users', uid, 'convs', convId)
    await deleteDoc(ref)
  } catch (e) {
    console.error('刪除雲端對話失敗：', e)
  }
}

// 單一角色寫入
export async function saveCharacterToCloud(uid: string, char: Character) {
  try {
    const ref = doc(db, 'users', uid, 'characters', char.id)
    await setDoc(ref, cleanForFirestore(char))
  } catch (e) {
    console.error('儲存角色到雲端失敗：', e)
  }
}

// 刪除雲端角色
export async function deleteCharacterFromCloud(uid: string, charId: string) {
  try {
    const ref = doc(db, 'users', uid, 'characters', charId)
    await deleteDoc(ref)
  } catch (e) {
    console.error('刪除雲端角色失敗：', e)
  }
}

// 批量寫入多個角色（例如模板新增、檔案匯入）
export async function saveCharactersToCloud(uid: string, chars: Character[]) {
  for (const c of chars) {
    await saveCharacterToCloud(uid, c)
  }
}

// 統計資料寫入（防抖）
export function debouncedSaveStats(uid: string, stats: Stats, delay = 500) {
  if (statsTimer) window.clearTimeout(statsTimer)
  statsTimer = window.setTimeout(async () => {
    statsTimer = null
    try {
      const ref = doc(db, 'users', uid, 'meta', 'stats')
      await setDoc(ref, cleanForFirestore(stats))
    } catch (e) {
      console.error('儲存統計到雲端失敗：', e)
    }
  }, delay)
}

// 成就資料寫入（防抖）
export function debouncedSaveAchv(uid: string, achv: Record<string, number>, delay = 500) {
  if (achvTimer) window.clearTimeout(achvTimer)
  achvTimer = window.setTimeout(async () => {
    achvTimer = null
    try {
      const ref = doc(db, 'users', uid, 'meta', 'achv')
      await setDoc(ref, cleanForFirestore(achv))
    } catch (e) {
      console.error('儲存成就到雲端失敗：', e)
    }
  }, delay)
}

export interface CloudSnapshot {
  characters: Character[]
  convs: Conversation[]
  stats: Stats | null
  achv: Record<string, number> | null
  hasData: boolean
}

// 一次性拉取雲端所有資料（用於登入初始判斷）
export async function fetchCloudData(uid: string): Promise<CloudSnapshot> {
  const [charsSnap, convsSnap, statsSnap, achvSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'characters')),
    getDocs(collection(db, 'users', uid, 'convs')),
    getDoc(doc(db, 'users', uid, 'meta', 'stats')),
    getDoc(doc(db, 'users', uid, 'meta', 'achv')),
  ])

  const characters = charsSnap.docs.map((d) => d.data() as Character)
  const convs = convsSnap.docs.map((d) => d.data() as Conversation)
  const stats = statsSnap.exists() ? (statsSnap.data() as Stats) : null
  const achv = achvSnap.exists() ? (achvSnap.data() as Record<string, number>) : null

  const statsHaveValues = stats && Object.values(stats).some((v) => Number(v) > 0)
  const achvHasValues = achv && Object.keys(achv).length > 0
  const hasData = characters.length > 0 || convs.length > 0 || !!statsHaveValues || !!achvHasValues

  return {
    characters,
    convs,
    stats,
    achv,
    hasData,
  }
}

// 上傳本機全部資料到雲端
export async function uploadAllToCloud(
  uid: string,
  data: {
    characters: Character[]
    convs: Conversation[]
    stats: Stats
    achv: Record<string, number>
  },
) {
  // 1. stats & achv
  await Promise.all([
    setDoc(doc(db, 'users', uid, 'meta', 'stats'), cleanForFirestore(data.stats)),
    setDoc(doc(db, 'users', uid, 'meta', 'achv'), cleanForFirestore(data.achv)),
  ])

  // 2. characters
  for (const c of data.characters) {
    await setDoc(doc(db, 'users', uid, 'characters', c.id), cleanForFirestore(c))
  }

  // 3. convs
  for (const cv of data.convs) {
    await setDoc(doc(db, 'users', uid, 'convs', cv.id), cleanForFirestore(cv))
  }
}

// 以本機覆蓋雲端（清除雲端舊角色與對話後上傳）
export async function overwriteCloudWithLocal(
  uid: string,
  data: {
    characters: Character[]
    convs: Conversation[]
    stats: Stats
    achv: Record<string, number>
  },
) {
  const [charsSnap, convsSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'characters')),
    getDocs(collection(db, 'users', uid, 'convs')),
  ])

  const deletePromises: Promise<void>[] = []
  charsSnap.docs.forEach((d) => deletePromises.push(deleteDoc(d.ref)))
  convsSnap.docs.forEach((d) => deletePromises.push(deleteDoc(d.ref)))
  await Promise.all(deletePromises)

  await uploadAllToCloud(uid, data)
}

// 即時監聽使用者的 4 個資料集合與文件
export function subscribeUserData(
  uid: string,
  callbacks: {
    onCharacters: (chars: Character[]) => void
    onConvs: (convs: Conversation[]) => void
    onStats: (stats: Stats) => void
    onAchv: (achv: Record<string, number>) => void
  },
) {
  const unsubs: (() => void)[] = []

  // 角色集合
  const unsubChars = onSnapshot(
    collection(db, 'users', uid, 'characters'),
    (snap) => {
      // 避免本機寫入時重複覆寫未完成的本地狀態
      if (snap.metadata.hasPendingWrites) return
      const list = snap.docs.map((d) => d.data() as Character)
      callbacks.onCharacters(list)
    },
    (err) => console.error('角色雲端監聽異常：', err),
  )
  unsubs.push(unsubChars)

  // 對話集合
  const unsubConvs = onSnapshot(
    collection(db, 'users', uid, 'convs'),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return
      const list = snap.docs.map((d) => d.data() as Conversation)
      callbacks.onConvs(list)
    },
    (err) => console.error('對話雲端監聽異常：', err),
  )
  unsubs.push(unsubConvs)

  // 統計文件
  const unsubStats = onSnapshot(
    doc(db, 'users', uid, 'meta', 'stats'),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return
      if (snap.exists()) {
        callbacks.onStats(snap.data() as Stats)
      }
    },
    (err) => console.error('統計雲端監聽異常：', err),
  )
  unsubs.push(unsubStats)

  // 成就文件
  const unsubAchv = onSnapshot(
    doc(db, 'users', uid, 'meta', 'achv'),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return
      if (snap.exists()) {
        callbacks.onAchv(snap.data() as Record<string, number>)
      }
    },
    (err) => console.error('成就雲端監聽異常：', err),
  )
  unsubs.push(unsubAchv)

  return () => {
    unsubs.forEach((u) => u())
  }
}

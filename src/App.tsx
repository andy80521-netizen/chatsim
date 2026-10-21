import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { useStored } from './storage'
import { ACHIEVEMENTS } from './achievements'
import { downloadJSON, normalizeCharacter } from './characters'
import {
  Character,
  Conversation,
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  Settings,
  StatKey,
  Stats,
  TNode,
  uid,
} from './types'
import { auth, loginWithGoogle, logoutFirebase } from './firebase'
import {
  CloudSnapshot,
  debouncedSaveAchv,
  debouncedSaveConv,
  debouncedSaveStats,
  deleteCharacterFromCloud,
  deleteConvFromCloud,
  fetchCloudData,
  overwriteCloudWithLocal,
  saveCharacterToCloud,
  saveCharactersToCloud,
  subscribeUserData,
  uploadAllToCloud,
} from './sync'
import Home, { DropLogo } from './components/Home'
import CharacterEditor from './components/CharacterEditor'
import Chat from './components/Chat'
import Modal from './components/Modal'
import Moment, { type MomentData } from './components/Moment'
import Icon from './components/Icon'

type View =
  | { name: 'home' }
  | { name: 'chat'; id: string }
  | { name: 'edit'; id: string | null; back: View }

type SyncModalState =
  | { type: 'upload_local'; cloudData: CloudSnapshot; uid: string }
  | { type: 'conflict'; cloudData: CloudSnapshot; uid: string }
  | null

export default function App() {
  const [characters, setCharacters] = useStored<Character[]>('chatsim2.characters', [])
  const [convs, setConvs] = useStored<Conversation[]>('chatsim2.convs', [])
  const [storedSettings, setSettings] = useStored<Settings>('chatsim2.settings', DEFAULT_SETTINGS)
  const [storedStats, setStats] = useStored<Stats>('chatsim2.stats', EMPTY_STATS)
  const [achv, setAchv] = useStored<Record<string, number>>('chatsim2.achv', {})
  const [view, setView] = useState<View>({ name: 'home' })
  const [toast, setToast] = useState('')
  const [moments, setMoments] = useState<MomentData[]>([])
  // 演出排隊：正在播放的那個不動，其餘依「升階 → 回憶 → 成就」排序
  const pushMoments = useCallback((list: MomentData[]) => {
    const rank = { stage: 0, fragment: 1, achv: 2 }
    setMoments((m) => {
      const [head, ...rest] = m
      const sorted = [...rest, ...list].sort((a, b) => rank[a.kind] - rank[b.kind])
      return head ? [head, ...sorted] : sorted
    })
  }, [])

  // Firebase 帳號與同步狀態
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [syncModal, setSyncModal] = useState<SyncModalState>(null)
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'char' | 'conv'
    id: string
    name: string
  } | null>(null)

  const activeUnsubRef = useRef<(() => void) | null>(null)
  const currentUserRef = useRef<User | null>(null)
  currentUserRef.current = currentUser

  const charactersRef = useRef(characters)
  charactersRef.current = characters
  const convsRef = useRef(convs)
  convsRef.current = convs
  const statsRef = useRef(storedStats)
  statsRef.current = storedStats
  const achvRef = useRef(achv)
  achvRef.current = achv

  const settings: Settings = { ...DEFAULT_SETTINGS, ...storedSettings }
  const stats: Stats = { ...EMPTY_STATS, ...storedStats }

  // 外觀：跟隨系統，或手動指定淺色／深色
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const mode = settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = mode
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#13111d' : '#fbf5f1')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  // 啟動 Firestore 即時監聽
  const startSubscription = useCallback(
    (targetUid: string) => {
      if (activeUnsubRef.current) {
        activeUnsubRef.current()
        activeUnsubRef.current = null
      }
      const unsub = subscribeUserData(targetUid, {
        onCharacters: (chars) => setCharacters(chars),
        onConvs: (cvs) => setConvs(cvs),
        onStats: (st) => setStats(st),
        onAchv: (ac) => setAchv(ac),
      })
      activeUnsubRef.current = unsub
    },
    [setCharacters, setConvs, setStats, setAchv],
  )

  // 監聽 Firebase 登入狀態變更
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setCurrentUser(u)
      if (!u) {
        if (activeUnsubRef.current) {
          activeUnsubRef.current()
          activeUnsubRef.current = null
        }
        return
      }

      const lastSyncedUid = localStorage.getItem('chatsim2.synced_uid')
      if (lastSyncedUid === u.uid) {
        // 此裝置此前已針對該帳號完成初次同步檢查，直接掛載即時監聽
        startSubscription(u.uid)
        return
      }

      // 初次登入或換帳號：檢查雲端與本機資料
      try {
        const cloud = await fetchCloudData(u.uid)
        const localHasData =
          charactersRef.current.length > 0 ||
          convsRef.current.length > 0 ||
          Object.values(statsRef.current).some((v) => Number(v) > 0) ||
          Object.keys(achvRef.current).length > 0

        if (!cloud.hasData && localHasData) {
          // 雲端是空的，本機有資料
          setSyncModal({ type: 'upload_local', cloudData: cloud, uid: u.uid })
        } else if (cloud.hasData && localHasData) {
          // 雲端和本機都有資料
          setSyncModal({ type: 'conflict', cloudData: cloud, uid: u.uid })
        } else if (cloud.hasData && !localHasData) {
          // 雲端有資料，本機是空的
          setCharacters(cloud.characters)
          setConvs(cloud.convs)
          if (cloud.stats) setStats(cloud.stats)
          if (cloud.achv) setAchv(cloud.achv)
          localStorage.setItem('chatsim2.synced_uid', u.uid)
          startSubscription(u.uid)
          setToast('已載入雲端資料')
        } else {
          // 兩邊都是空的
          localStorage.setItem('chatsim2.synced_uid', u.uid)
          startSubscription(u.uid)
        }
      } catch (e) {
        console.error('初次拉取雲端狀態失敗：', e)
        startSubscription(u.uid)
      }
    })

    return () => {
      unsubAuth()
      if (activeUnsubRef.current) {
        activeUnsubRef.current()
      }
    }
  }, [startSubscription, setCharacters, setConvs, setStats, setAchv])

  // ---- 統計與成就 ----
  const bump = useCallback(
    (k: StatKey, n = 1) =>
      setStats((s) => {
        const next = { ...EMPTY_STATS, ...s, [k]: (s[k] ?? 0) + n }
        if (currentUserRef.current) {
          debouncedSaveStats(currentUserRef.current.uid, next)
        }
        return next
      }),
    [setStats],
  )

  const statMax = useCallback(
    (k: StatKey, v: number) =>
      setStats((s) => {
        if ((s[k] ?? 0) >= v) return s
        const next = { ...EMPTY_STATS, ...s, [k]: v }
        if (currentUserRef.current) {
          debouncedSaveStats(currentUserRef.current.uid, next)
        }
        return next
      }),
    [setStats],
  )

  useEffect(() => {
    const fresh = ACHIEVEMENTS.filter((a) => !achv[a.id] && a.test(stats, { characters: characters.length }))
    if (!fresh.length) return
    setAchv((prev) => {
      const next = { ...prev }
      fresh.forEach((a) => (next[a.id] = Date.now()))
      if (currentUserRef.current) {
        debouncedSaveAchv(currentUserRef.current.uid, next)
      }
      return next
    })
    pushMoments(fresh.map((a) => ({ kind: 'achv' as const, title: a.title, sub: a.desc })))
  }, [storedStats, characters.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // ---- 角色操作 ----
  const saveCharacter = (c: Character) => {
    setCharacters((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]))
    if (currentUser) {
      void saveCharacterToCloud(currentUser.uid, c)
    }
  }

  const promptDeleteCharacter = (id: string) => {
    const target = characters.find((c) => c.id === id)
    if (!target) return
    setConfirmDelete({ type: 'char', id, name: target.name })
  }

  const doDeleteCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id))
    if (currentUser) {
      void deleteCharacterFromCloud(currentUser.uid, id)
    }
    setView({ name: 'home' })
  }

  // ---- 對話操作 ----
  const newConv = (ids: string[]) => {
    const chosen = ids.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c)
    if (!chosen.length) return
    const now = Date.now()
    const nodes: Record<string, TNode> = {}
    let leaf: string | null = null
    chosen.forEach((c, i) => {
      if (!c.greeting.trim()) return
      const n: TNode = { id: uid(), parentId: leaf, role: 'assistant', content: c.greeting, ts: now + i, speakerId: c.id }
      nodes[n.id] = n
      leaf = n.id
    })
    const conv: Conversation = {
      id: uid(),
      title: chosen.map((c) => c.name).join('、'),
      characterIds: chosen.map((c) => c.id),
      nodes,
      leafId: leaf,
      pinned: '',
      createdAt: now,
      updatedAt: now,
    }
    setConvs((prev) => [conv, ...prev])
    if (currentUser) {
      debouncedSaveConv(currentUser.uid, conv)
    }
    if (chosen.length > 1) bump('groupConvs')
    setView({ name: 'chat', id: conv.id })
  }

  const promptDeleteConv = (id: string) => {
    const target = convs.find((c) => c.id === id)
    if (!target) return
    setConfirmDelete({ type: 'conv', id, name: target.title })
  }

  const doDeleteConv = (id: string) => {
    setConvs((prev) => prev.filter((c) => c.id !== id))
    if (currentUser) {
      void deleteConvFromCloud(currentUser.uid, id)
    }
  }

  // ---- 備份匯出匯入 ----
  const exportAll = () => downloadJSON('chatsim-backup.json', { v: 2, characters, convs, stats, achv })

  const importAll = async (file: File) => {
    try {
      const d = JSON.parse(await file.text())
      if (d.v !== 2) throw new Error('version')
      const nextChars = d.characters ?? []
      const nextConvs = d.convs ?? []
      const nextStats = { ...EMPTY_STATS, ...(d.stats ?? {}) }
      const nextAchv = d.achv ?? {}

      setCharacters(nextChars)
      setConvs(nextConvs)
      setStats(nextStats)
      setAchv(nextAchv)

      if (currentUser) {
        await overwriteCloudWithLocal(currentUser.uid, {
          characters: nextChars,
          convs: nextConvs,
          stats: nextStats,
          achv: nextAchv,
        })
      }
      setToast('匯入完成')
    } catch {
      setToast('檔案格式不正確（需要由本程式匯出的備份）')
    }
  }

  // ---- 登入與登出處理 ----
  const handleLogin = async () => {
    try {
      await loginWithGoogle()
      setToast('登入成功')
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '登入失敗'
      if (!msg.includes('popup-closed-by-user')) {
        setToast(`登入失敗：${msg.slice(0, 80)}`)
      }
    }
  }

  const handleLogout = async () => {
    try {
      if (activeUnsubRef.current) {
        activeUnsubRef.current()
        activeUnsubRef.current = null
      }
      await logoutFirebase()
      setCurrentUser(null)
      setToast('已登出，目前使用本機模式')
    } catch (err: unknown) {
      setToast(`登出失敗：${(err as Error)?.message || ''}`)
    }
  }

  // ---- 畫面 ----
  // 手機：一次只顯示一個畫面；電腦：左側欄（首頁）＋右側主畫面
  let body
  let screen: 'home' | 'chat' | 'edit' = 'home'

  if (view.name === 'edit') {
    screen = 'edit'
    const existing = characters.find((c) => c.id === view.id) ?? null
    const back = view.back
    body = (
      <CharacterEditor
        key={view.id ?? 'new'}
        initial={existing}
        settings={settings}
        onSave={(c) => {
          saveCharacter(c)
          setToast(existing ? `已儲存 ${c.name}` : `${c.name} 加入了你的角色`)
          setView(back)
        }}
        onCancel={() => setView(back)}
        onDelete={existing ? () => promptDeleteCharacter(existing.id) : undefined}
        onToast={setToast}
      />
    )
  } else if (view.name === 'chat') {
    const conv = convs.find((c) => c.id === view.id)
    if (conv) {
      screen = 'chat'
      const chatView = view
      body = (
        <Chat
          key={conv.id}
          conv={conv}
          characters={characters}
          settings={settings}
          onUpdate={(fn) =>
            setConvs((prev) => {
              const next = prev.map((c) => (c.id === conv.id ? { ...fn(c), updatedAt: Date.now() } : c))
              const updatedConv = next.find((c) => c.id === conv.id)
              if (updatedConv && currentUser) {
                debouncedSaveConv(currentUser.uid, updatedConv)
              }
              return next
            })
          }
          bump={bump}
          statMax={statMax}
          onBack={() => setView({ name: 'home' })}
          onEditChar={(id) => setView({ name: 'edit', id, back: chatView })}
          onMoments={pushMoments}
          onDelete={() => promptDeleteConv(conv.id)}
        />
      )
    }
  }

  const lastConv = [...convs].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (!body) {
    body = (
      <div className="welcome">
        <div className="welcome-inner">
          <DropLogo className="welcome-drop" />
          <h2>{characters.length ? '今天想和誰說話？' : '先找一位想說話的人'}</h2>
          <p className="hint">
            {characters.length
              ? '從左邊挑一位角色，或接著上次的對話。'
              : '到左邊的「模板」加入一位現成的角色，或自己寫一位。'}
          </p>
          {lastConv && (
            <button className="btn primary" onClick={() => setView({ name: 'chat', id: lastConv.id })}>
              <Icon name="chat" size={18} />
              繼續和{lastConv.title}聊
            </button>
          )}
        </div>
      </div>
    )
  }

  const activeConvId = view.name === 'chat' ? view.id : null
  const side = (
      <Home
        characters={characters}
        convs={convs}
        settings={settings}
        achv={achv}
        activeConvId={activeConvId}
        onToast={setToast}
        currentUser={currentUser}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onOpenConv={(id) => setView({ name: 'chat', id })}
        onNewConv={newConv}
        onDeleteConv={promptDeleteConv}
        onEditChar={(id) => setView({ name: 'edit', id, back: { name: 'home' } })}
        onAddChars={(list) => {
          setCharacters((prev) => [...prev, ...list])
          if (currentUser) {
            void saveCharactersToCloud(currentUser.uid, list)
          }
          setToast(`已加入 ${list.length} 個角色`)
        }}
        onSaveSettings={(s) => {
          const onlyTheme = s.theme !== settings.theme
          setSettings(s)
          if (!onlyTheme) setToast('設定已儲存')
        }}
        onExportAll={exportAll}
        onImportAll={importAll}
        normalize={normalizeCharacter}
      />
  )

  return (
    <>
      <div className="shell" data-screen={screen}>
        <aside className="side">{side}</aside>
        <main className="stage">{body}</main>
      </div>
      {toast && (
        <div className="toast" role="status" key={toast}>
          {toast}
        </div>
      )}
      {moments[0] && (
        <Moment key={moments[0].kind + moments[0].title} m={moments[0]} onDone={() => setMoments((m) => m.slice(1))} />
      )}

      {/* 刪除確認 */}
      {confirmDelete && (
        <Modal
          title={confirmDelete.type === 'char' ? `刪除角色「${confirmDelete.name}」？` : `刪除和${confirmDelete.name}的對話？`}
          onClose={() => setConfirmDelete(null)}
        >
          <p className="hint">
            {confirmDelete.type === 'char'
              ? '用到這位角色的對話會留著，但沒辦法再繼續聊。刪了就找不回來。'
              : '這段對話的所有分支、好感和記憶都會一起刪除，刪了就找不回來。'}
          </p>
          <div className="sheet-actions">
            <button className="btn quiet" onClick={() => setConfirmDelete(null)}>
              取消
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirmDelete.type === 'char') {
                  doDeleteCharacter(confirmDelete.id)
                } else {
                  doDeleteConv(confirmDelete.id)
                  if (view.name === 'chat' && view.id === confirmDelete.id) setView({ name: 'home' })
                }
                setConfirmDelete(null)
              }}
            >
              刪除
            </button>
          </div>
        </Modal>
      )}

      {/* 初次登入：雲端是空的，本機有資料 */}
      {syncModal?.type === 'upload_local' && (
        <Modal title="把這台裝置的資料帶上雲端？" onClose={() => {}} dismissable={false}>
          <p className="hint">
            你的雲端還是空的，這台裝置上有 {characters.length} 位角色、{convs.length} 段對話。上傳之後，用同一個 Google
            帳號登入的手機或電腦都看得到。
          </p>
          <div className="sheet-actions stack">
            <button
              className="btn primary block"
              onClick={async () => {
                const targetUid = syncModal.uid
                await uploadAllToCloud(targetUid, {
                  characters,
                  convs,
                  stats,
                  achv,
                })
                localStorage.setItem('chatsim2.synced_uid', targetUid)
                startSubscription(targetUid)
                setSyncModal(null)
                setToast('已上傳到雲端')
              }}
            >
              <Icon name="upload" size={18} />
              上傳到雲端
            </button>
            <button
              className="btn quiet block"
              onClick={() => {
                const targetUid = syncModal.uid
                localStorage.setItem('chatsim2.synced_uid', targetUid)
                startSubscription(targetUid)
                setSyncModal(null)
                setToast('已開始同步，雲端維持空白')
              }}
            >
              先不要
            </button>
          </div>
        </Modal>
      )}

      {/* 初次登入：雲端與本機都有資料 */}
      {syncModal?.type === 'conflict' && (
        <Modal title="要用哪一份資料？" onClose={() => {}} dismissable={false}>
          <p className="hint">
            雲端有 {syncModal.cloudData.characters.length} 位角色、{syncModal.cloudData.convs.length} 段對話；這台裝置有{' '}
            {characters.length} 位角色、{convs.length} 段對話。選了之後，另一份會被覆蓋。不確定的話，先到設定匯出備份。
          </p>
          <div className="sheet-actions stack">
            <button
              className="btn primary block"
              onClick={() => {
                const targetUid = syncModal.uid
                const cloud = syncModal.cloudData
                setCharacters(cloud.characters)
                setConvs(cloud.convs)
                if (cloud.stats) setStats(cloud.stats)
                if (cloud.achv) setAchv(cloud.achv)
                localStorage.setItem('chatsim2.synced_uid', targetUid)
                startSubscription(targetUid)
                setSyncModal(null)
                setToast('已換成雲端的資料')
              }}
            >
              <Icon name="cloud" size={18} />
              用雲端的，覆蓋這台裝置
            </button>
            <button
              className="btn danger block"
              onClick={async () => {
                const targetUid = syncModal.uid
                await overwriteCloudWithLocal(targetUid, {
                  characters,
                  convs,
                  stats,
                  achv,
                })
                localStorage.setItem('chatsim2.synced_uid', targetUid)
                startSubscription(targetUid)
                setSyncModal(null)
                setToast('已用這台裝置的資料覆蓋雲端')
              }}
            >
              用這台裝置的，覆蓋雲端
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

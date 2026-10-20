import { useCallback, useEffect, useState } from 'react'
import { useStored } from './storage'
import { ACHIEVEMENTS } from './achievements'
import { downloadJSON, normalizeCharacter } from './characters'
import { Character, Conversation, DEFAULT_SETTINGS, EMPTY_STATS, Settings, StatKey, Stats, TNode, uid } from './types'
import Home from './components/Home'
import CharacterEditor from './components/CharacterEditor'
import Chat from './components/Chat'

type View =
  | { name: 'home' }
  | { name: 'chat'; id: string }
  | { name: 'edit'; id: string | null; back: View }

export default function App() {
  const [characters, setCharacters] = useStored<Character[]>('chatsim2.characters', [])
  const [convs, setConvs] = useStored<Conversation[]>('chatsim2.convs', [])
  const [storedSettings, setSettings] = useStored<Settings>('chatsim2.settings', DEFAULT_SETTINGS)
  const [storedStats, setStats] = useStored<Stats>('chatsim2.stats', EMPTY_STATS)
  const [achv, setAchv] = useStored<Record<string, number>>('chatsim2.achv', {})
  const [view, setView] = useState<View>({ name: 'home' })
  const [toast, setToast] = useState('')

  const settings: Settings = { ...DEFAULT_SETTINGS, ...storedSettings }
  const stats: Stats = { ...EMPTY_STATS, ...storedStats }

  // ---- 統計與成就 ----
  const bump = useCallback(
    (k: StatKey, n = 1) => setStats((s) => ({ ...EMPTY_STATS, ...s, [k]: (s[k] ?? 0) + n })),
    [setStats],
  )
  const statMax = useCallback(
    (k: StatKey, v: number) => setStats((s) => ((s[k] ?? 0) >= v ? s : { ...EMPTY_STATS, ...s, [k]: v })),
    [setStats],
  )

  useEffect(() => {
    const fresh = ACHIEVEMENTS.filter((a) => !achv[a.id] && a.test(stats, { characters: characters.length }))
    if (!fresh.length) return
    setAchv((prev) => {
      const next = { ...prev }
      fresh.forEach((a) => (next[a.id] = Date.now()))
      return next
    })
    setToast(`🏆 解鎖成就：${fresh.map((a) => a.title).join('、')}`)
  }, [storedStats, characters.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // ---- 角色 ----
  const saveCharacter = (c: Character) => {
    setCharacters((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]))
  }

  const deleteCharacter = (id: string) => {
    if (!confirm('確定刪除這個角色？（用到它的對話會保留，但需要重新選角色）')) return
    setCharacters((prev) => prev.filter((c) => c.id !== id))
    setView({ name: 'home' })
  }

  // ---- 對話 ----
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
    if (chosen.length > 1) bump('groupConvs')
    setView({ name: 'chat', id: conv.id })
  }

  const deleteConv = (id: string) => {
    if (confirm('確定刪除這個對話？')) setConvs((prev) => prev.filter((c) => c.id !== id))
  }

  // ---- 備份 ----
  const exportAll = () => downloadJSON('chatsim-backup.json', { v: 2, characters, convs, stats, achv })

  const importAll = async (file: File) => {
    try {
      const d = JSON.parse(await file.text())
      if (d.v !== 2) throw new Error('version')
      setCharacters(d.characters ?? [])
      setConvs(d.convs ?? [])
      setStats({ ...EMPTY_STATS, ...(d.stats ?? {}) })
      setAchv(d.achv ?? {})
      alert('匯入完成')
    } catch {
      alert('檔案格式不正確（需要由本程式匯出的備份）')
    }
  }

  // ---- 畫面 ----
  let body

  if (view.name === 'edit') {
    const existing = characters.find((c) => c.id === view.id) ?? null
    const back = view.back
    body = (
      <CharacterEditor
        initial={existing}
        settings={settings}
        onSave={(c) => {
          saveCharacter(c)
          setView(back)
        }}
        onCancel={() => setView(back)}
        onDelete={existing ? () => deleteCharacter(existing.id) : undefined}
      />
    )
  } else if (view.name === 'chat') {
    const conv = convs.find((c) => c.id === view.id)
    if (conv) {
      const chatView = view
      body = (
        <Chat
          key={conv.id}
          conv={conv}
          characters={characters}
          settings={settings}
          onUpdate={(fn) =>
            setConvs((prev) => prev.map((c) => (c.id === conv.id ? { ...fn(c), updatedAt: Date.now() } : c)))
          }
          bump={bump}
          statMax={statMax}
          onBack={() => setView({ name: 'home' })}
          onEditChar={(id) => setView({ name: 'edit', id, back: chatView })}
        />
      )
    }
  }

  if (!body) {
    body = (
      <Home
        characters={characters}
        convs={convs}
        settings={settings}
        achv={achv}
        onOpenConv={(id) => setView({ name: 'chat', id })}
        onNewConv={newConv}
        onDeleteConv={deleteConv}
        onEditChar={(id) => setView({ name: 'edit', id, back: { name: 'home' } })}
        onAddChars={(list) => {
          setCharacters((prev) => [...prev, ...list])
          setToast(`已加入 ${list.length} 個角色`)
        }}
        onSaveSettings={(s) => {
          setSettings(s)
          setToast('設定已儲存')
        }}
        onExportAll={exportAll}
        onImportAll={importAll}
        normalize={normalizeCharacter}
      />
    )
  }

  return (
    <>
      {body}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Character, Conversation, Settings, StatKey, TNode } from '../types'
import { clamp, uid } from '../types'
import { affectionOf, childMap, context, descendants, latestLeaf, moodOf, pathTo, stageOf } from '../tree'
import { buildSystemPrompt, displayText, mergeTurns, parseMeta, splitReply, streamModel, summarizeChunk } from '../llm'
import type { Turn } from '../llm'
import { createRecognizer, speak, stopSpeaking } from '../speech'
import type { Recognizer } from '../speech'
import Panel from './Panel'
import Modal from './Modal'

interface Props {
  conv: Conversation
  characters: Character[]
  settings: Settings
  onUpdate: (fn: (c: Conversation) => Conversation) => void
  bump: (k: StatKey, n?: number) => void
  statMax: (k: StatKey, v: number) => void
  onBack: () => void
  onEditChar: (id: string) => void
}

type Work = { nodes: Record<string, TNode>; leaf: string | null }

const SUMMARIZE_AFTER = 40 // 未摘要訊息超過這麼多則就觸發
const SUMMARIZE_CHUNK = 20 // 每次摘要最舊的這麼多則

export default function Chat({ conv, characters, settings, onUpdate, bump, statMax, onBack, onEditChar }: Props) {
  const charMap = useMemo(
    () => Object.fromEntries(characters.map((c) => [c.id, c])) as Record<string, Character>,
    [characters],
  )
  const chars = conv.characterIds.map((id) => charMap[id]).filter((c): c is Character => !!c)
  const single = conv.characterIds.length === 1

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [streaming, setStreaming] = useState<{ speakerId: string; text: string } | null>(null)
  const [panel, setPanel] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [listening, setListening] = useState(false)
  const [callMode, setCallMode] = useState(false)

  // 這些 ref 讓非同步流程（串流、語音回呼）永遠讀到最新值
  const convRef = useRef(conv)
  convRef.current = conv
  const busyRef = useRef(false)
  const callRef = useRef(false)
  const stopRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const recogRef = useRef<Recognizer | null>(null)
  const greetedRef = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v
    setBusy(v)
  }

  const path = useMemo(() => pathTo(conv.nodes, conv.leafId), [conv.nodes, conv.leafId])
  const ctx = useMemo(() => context(path), [path])
  const cm = useMemo(() => childMap(conv.nodes), [conv.nodes])
  const aff = affectionOf(path)
  const stage = stageOf(aff)
  const mood = moodOf(path)
  const days = Math.max(1, Math.ceil((Date.now() - conv.createdAt) / 86400000))

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [path.length, streaming?.text])

  // 離開畫面時收尾
  useEffect(() => {
    return () => {
      callRef.current = false
      abortRef.current?.abort()
      try {
        recogRef.current?.abort()
      } catch {
        /* ignore */
      }
      stopSpeaking()
    }
  }, [])

  // 隔很久才回來 → 角色主動打招呼
  useEffect(() => {
    if (greetedRef.current) return
    greetedRef.current = true
    const last = path[path.length - 1]
    if (!settings.apiKey || !settings.greetAfterHours || !last || !chars.length) return
    const hours = (Date.now() - last.ts) / 3600000
    if (hours >= settings.greetAfterHours) void greet(Math.round(hours))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 核心：新增節點、產生回覆 ----------

  function addNode(work: Work, node: TNode) {
    if (Object.values(work.nodes).some((n) => n.parentId === node.parentId)) bump('branches')
    work.nodes[node.id] = node
    work.leaf = node.id
    onUpdate((c) => ({ ...c, nodes: { ...c.nodes, [node.id]: node }, leafId: node.id }))
  }

  function toTurn(n: TNode, speaker: Character): Turn {
    if (n.role === 'user') return { role: 'user', text: n.content }
    if (!n.speakerId || n.speakerId === speaker.id) return { role: 'model', text: n.content }
    return { role: 'user', text: `${charMap[n.speakerId]?.name ?? '其他人'}：${n.content}` }
  }

  async function generateNode(work: Work, speaker: Character, transient?: string): Promise<TNode | null> {
    const p = pathTo(work.nodes, work.leaf)
    const c = context(p)
    const a = affectionOf(p)
    const system = buildSystemPrompt({
      speaker,
      members: chars,
      memory: c.memory,
      pinned: convRef.current.pinned,
      affection: a,
      stage: stageOf(a).name,
      unlocked: single ? speaker.fragments.filter((f) => a >= f.unlockAt) : [],
      single,
    })
    const turns = c.history.map((n) => toTurn(n, speaker))
    if (transient) turns.push({ role: 'user', text: transient })

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let raw = ''
    setStreaming({ speakerId: speaker.id, text: '' })
    try {
      await streamModel({
        settings,
        system,
        turns: mergeTurns(turns),
        signal: ctrl.signal,
        onToken: (t) => {
          raw += t
          setStreaming({ speakerId: speaker.id, text: displayText(raw) })
        },
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
    setStreaming(null)

    const { text, metaRaw } = splitReply(raw)
    if (!text) return null

    const node: TNode = {
      id: uid(),
      parentId: work.leaf,
      role: 'assistant',
      content: text,
      ts: Date.now(),
      speakerId: speaker.id,
    }
    if (single) {
      const meta = parseMeta(metaRaw)
      node.affection = clamp(a + meta.affection, 0, 100)
      node.mood = meta.mood
      if (speaker.innerVoice) node.inner = meta.inner
    }
    addNode(work, node)
    return node
  }

  async function respond(work: Work, speakers: Character[], transient?: string) {
    stopRef.current = false
    let last: TNode | null = null
    for (const sp of speakers) {
      if (stopRef.current) break
      const n = await generateNode(work, sp, transient)
      if (!n) break
      last = n
    }

    const a = affectionOf(pathTo(work.nodes, work.leaf))
    statMax('maxAffection', a)
    if (single && chars[0]) {
      statMax('fragments', chars[0].fragments.filter((f) => f.unlockAt > 0 && a >= f.unlockAt).length)
    }
    void maybeSummarize(work)

    if (last && (settings.ttsAuto || callRef.current)) {
      bump('tts')
      speak(last.content, settings.lang, () => {
        if (callRef.current) startListening()
      })
    } else if (callRef.current) {
      startListening()
    }
  }

  async function maybeSummarize(work: Work) {
    const c = context(pathTo(work.nodes, work.leaf))
    if (c.history.length <= SUMMARIZE_AFTER) return
    const chunk = c.history.slice(0, SUMMARIZE_CHUNK)
    const userName = chars[0]?.userName || '使用者'
    const lines = chunk.map(
      (n) => `${n.role === 'user' ? userName : (charMap[n.speakerId ?? '']?.name ?? chars[0]?.name ?? '角色')}：${n.content}`,
    )
    try {
      const text = await summarizeChunk(settings, c.memory, lines)
      const target = chunk[chunk.length - 1].id
      // 記憶掛在節點上，所以只影響這條分支和它的後代
      onUpdate((cv) =>
        cv.nodes[target] ? { ...cv, nodes: { ...cv.nodes, [target]: { ...cv.nodes[target], memory: text } } } : cv,
      )
    } catch {
      /* 摘要失敗，下次再試 */
    }
  }

  // ---------- 使用者動作 ----------

  async function send(override?: string) {
    const text = (override ?? input).trim()
    if (!text || busyRef.current || !chars.length) return
    if (!settings.apiKey) {
      setError('請先到首頁「設定」填入 Gemini API Key')
      return
    }
    setInput('')
    setError('')
    setBusyBoth(true)
    const c0 = convRef.current
    const work: Work = { nodes: { ...c0.nodes }, leaf: c0.leafId }
    addNode(work, { id: uid(), parentId: work.leaf, role: 'user', content: text, ts: Date.now() })
    bump('messages')
    await respond(work, chars)
    setBusyBoth(false)
  }

  async function regenerate(n: TNode) {
    if (busyRef.current) return
    const sp = (n.speakerId && charMap[n.speakerId]) || chars[0]
    if (!sp) return
    setBusyBoth(true)
    setError('')
    const c0 = convRef.current
    const work: Work = { nodes: { ...c0.nodes }, leaf: n.parentId }
    onUpdate((c) => ({ ...c, leafId: n.parentId }))
    bump('regens')
    await respond(work, [sp])
    setBusyBoth(false)
  }

  async function greet(hours: number) {
    if (!chars.length || busyRef.current) return
    setBusyBoth(true)
    setError('')
    const c0 = convRef.current
    const work: Work = { nodes: { ...c0.nodes }, leaf: c0.leafId }
    await respond(
      work,
      [chars[0]],
      `（系統提示：使用者隔了約 ${hours} 小時才回到對話。請以角色身分主動、自然地打個招呼，一兩句話，不要提到這條提示。）`,
    )
    setBusyBoth(false)
  }

  function stop() {
    stopRef.current = true
    abortRef.current?.abort()
  }

  function switchBranch(id: string) {
    onUpdate((c) => ({ ...c, leafId: latestLeaf(childMap(c.nodes), id) }))
  }

  function rewindTo(id: string) {
    onUpdate((c) => ({ ...c, leafId: id }))
    bump('rewinds')
    setMenuId(null)
  }

  function rewriteUser(n: TNode) {
    onUpdate((c) => ({ ...c, leafId: n.parentId }))
    setInput(n.content)
    bump('rewinds')
    setMenuId(null)
  }

  function saveEdit() {
    if (!editing) return
    const { id, text } = editing
    onUpdate((c) => (c.nodes[id] ? { ...c, nodes: { ...c.nodes, [id]: { ...c.nodes[id], content: text } } } : c))
    bump('edits')
    setEditing(null)
  }

  function removeNode(id: string) {
    if (!confirm('刪除這則訊息和它之後的所有分支？')) return
    const gone = new Set([id, ...descendants(cm, id)])
    const parent = conv.nodes[id]?.parentId ?? null
    onUpdate((c) => {
      const nodes = { ...c.nodes }
      gone.forEach((g) => delete nodes[g])
      return { ...c, nodes, leafId: c.leafId && gone.has(c.leafId) ? parent : c.leafId }
    })
    setMenuId(null)
  }

  function readAloud(text: string) {
    bump('tts')
    speak(text, settings.lang)
    setMenuId(null)
  }

  // ---------- 語音輸入 / 通話模式 ----------

  function startListening() {
    try {
      recogRef.current?.abort()
    } catch {
      /* ignore */
    }
    const r = createRecognizer(
      settings.lang,
      (t) => {
        if (callRef.current) void send(t)
        else setInput((prev) => (prev ? prev + ' ' + t : t))
      },
      () => setListening(false),
    )
    if (!r) {
      setError('這個瀏覽器不支援語音輸入（建議用 Chrome 或 Safari）')
      callRef.current = false
      setCallMode(false)
      return
    }
    recogRef.current = r
    setListening(true)
    try {
      r.start()
    } catch {
      setListening(false)
    }
  }

  function toggleMic() {
    if (listening) {
      try {
        recogRef.current?.abort()
      } catch {
        /* ignore */
      }
      setListening(false)
    } else startListening()
  }

  function toggleCall() {
    if (callRef.current) {
      callRef.current = false
      setCallMode(false)
      try {
        recogRef.current?.abort()
      } catch {
        /* ignore */
      }
      stopSpeaking()
      setListening(false)
    } else {
      callRef.current = true
      setCallMode(true)
      startListening()
    }
  }

  // ---------- 畫面 ----------

  if (!chars.length) {
    return (
      <div className="screen">
        <header className="bar">
          <button className="ghost" onClick={onBack}>‹ 返回</button>
          <h1>{conv.title}</h1>
          <span />
        </header>
        <p className="empty">這個對話的角色已被刪除，請建立新對話。</p>
      </div>
    )
  }

  const menuNode = menuId ? conv.nodes[menuId] : undefined

  return (
    <div className="screen chat">
      <header className="bar">
        <button className="ghost" onClick={onBack}>‹ 返回</button>
        <h1>{single ? chars[0].name : conv.title}</h1>
        <button className="ghost" onClick={() => setPanel(true)}>☰</button>
      </header>

      {single && (
        <div className="status">
          <span className="badge">{stage.name}</span>
          <div className="meter"><i style={{ width: `${aff}%` }} /></div>
          <span>{aff}</span>
          {mood && <span className="dim">· {mood}</span>}
          <span className="dim">· 相識 {days} 天</span>
        </div>
      )}

      <main className="msgs">
        {ctx.memory && <div className="memory">🧠 已記住較早的對話</div>}

        {path.map((n, i) => {
          const sib = cm[n.parentId ?? 'ROOT'] ?? []
          const idx = sib.indexOf(n.id)
          const sp = n.speakerId ? charMap[n.speakerId] : undefined
          const isLast = i === path.length - 1
          return (
            <div key={n.id} id={`n-${n.id}`} className={`msg ${n.role}`}>
              {!single && n.role === 'assistant' && <div className="who">{sp?.name ?? '?'}</div>}
              <div className={`bubble ${n.role}`} onClick={() => setMenuId(n.id)}>{n.content}</div>
              {n.inner && <div className="inner">💭 {n.inner}</div>}
              {sib.length > 1 && (
                <div className="switch">
                  <button className="ghost small" onClick={() => switchBranch(sib[(idx - 1 + sib.length) % sib.length])}>‹</button>
                  <span>{idx + 1}/{sib.length}</span>
                  <button className="ghost small" onClick={() => switchBranch(sib[(idx + 1) % sib.length])}>›</button>
                </div>
              )}
              {isLast && n.role === 'assistant' && !busy && (
                <button className="ghost small" onClick={() => void regenerate(n)}>↻ 重新生成</button>
              )}
            </div>
          )
        })}

        {streaming && (
          <div className="msg assistant">
            {!single && <div className="who">{charMap[streaming.speakerId]?.name}</div>}
            <div className="bubble assistant">{streaming.text || '…'}</div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <div ref={endRef} />
      </main>

      <footer className="composer">
        {callMode && <div className="hint center">📞 通話模式：說話 → 自動送出 → 角色回覆並朗讀{listening ? '（聆聽中…）' : ''}</div>}
        <div className="inputrow">
          <button className={`icon ${listening ? 'live' : ''}`} onClick={toggleMic} title="語音輸入">🎤</button>
          <button className={`icon ${callMode ? 'live' : ''}`} onClick={toggleCall} title="通話模式">📞</button>
          <textarea
            rows={1}
            value={input}
            placeholder="輸入訊息…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          {busy ? (
            <button onClick={stop}>■ 停止</button>
          ) : (
            <button className="primary" onClick={() => void send()} disabled={!input.trim()}>送出</button>
          )}
        </div>
      </footer>

      {panel && (
        <Panel
          conv={conv}
          path={path}
          memory={{ text: ctx.memory, nodeId: ctx.memoryNodeId }}
          chars={chars}
          single={single}
          aff={aff}
          onUpdate={onUpdate}
          onJump={(leaf) => onUpdate((c) => ({ ...c, leafId: leaf }))}
          onScroll={(id) => document.getElementById(`n-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          onEditChar={(id) => onEditChar(id)}
          onClose={() => setPanel(false)}
        />
      )}

      {menuNode && (
        <Modal onClose={() => setMenuId(null)}>
          <div className="menu">
            {menuNode.role === 'assistant' && <button onClick={() => readAloud(menuNode.content)}>🔊 朗讀</button>}
            <button onClick={() => { setEditing({ id: menuNode.id, text: menuNode.content }); setMenuId(null) }}>✏️ 編輯</button>
            <button onClick={() => { void navigator.clipboard?.writeText(menuNode.content); setMenuId(null) }}>📋 複製</button>
            {menuNode.role === 'assistant' ? (
              <button onClick={() => rewindTo(menuNode.id)}>⏪ 回到這裡重來（開新分支）</button>
            ) : (
              <button onClick={() => rewriteUser(menuNode)}>✍️ 改寫這句（開新分支）</button>
            )}
            <button className="danger" onClick={() => removeNode(menuNode.id)}>🗑 刪除這則與之後分支</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="編輯訊息" onClose={() => setEditing(null)}>
          <textarea rows={6} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          <button className="primary" onClick={saveEdit}>儲存</button>
        </Modal>
      )}
    </div>
  )
}

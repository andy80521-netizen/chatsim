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
import Icon from './Icon'
import Avatar from './Avatar'
import Droplet from './Droplet'
import type { MomentData } from './Moment'

interface Props {
  conv: Conversation
  characters: Character[]
  settings: Settings
  onUpdate: (fn: (c: Conversation) => Conversation) => void
  bump: (k: StatKey, n?: number) => void
  statMax: (k: StatKey, v: number) => void
  onBack: () => void
  onEditChar: (id: string) => void
  onMoments: (list: MomentData[]) => void
  onDelete: () => void
}

type Work = { nodes: Record<string, TNode>; leaf: string | null }

const SUMMARIZE_AFTER = 40 // 未摘要訊息超過這麼多則就觸發
const SUMMARIZE_CHUNK = 20 // 每次摘要最舊的這麼多則

export default function Chat({ conv, characters, settings, onUpdate, bump, statMax, onBack, onEditChar, onMoments, onDelete }: Props) {
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
  const [openInner, setOpenInner] = useState<Record<string, boolean>>({})

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
  const mountedAt = useRef(Date.now())

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
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
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
    const before = affectionOf(pathTo(work.nodes, work.leaf))
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

      // 關鍵時刻：關係升階、回憶碎片解鎖
      const queue: MomentData[] = []
      const sBefore = stageOf(before)
      const sAfter = stageOf(a)
      if (sAfter.min > sBefore.min) {
        queue.push({ kind: 'stage', title: sAfter.name, sub: `你和${chars[0].name}的距離又近了一點。` })
      }
      for (const f of chars[0].fragments) {
        if (f.unlockAt > before && f.unlockAt <= a) {
          queue.push({ kind: 'fragment', title: f.title || '一段過去', sub: `${chars[0].name}願意讓你知道了。到資訊面板看看。` })
        }
      }
      if (queue.length) onMoments(queue)
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
      setError('還沒填 Gemini API Key。到首頁的「設定」填好再回來。')
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

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  function removeNode(id: string) {
    const gone = new Set([id, ...descendants(cm, id)])
    const parent = conv.nodes[id]?.parentId ?? null
    onUpdate((c) => {
      const nodes = { ...c.nodes }
      gone.forEach((g) => delete nodes[g])
      return { ...c, nodes, leafId: c.leafId && gone.has(c.leafId) ? parent : c.leafId }
    })
    setConfirmRemove(null)
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
      setError('這個瀏覽器不支援語音輸入，請改用 Chrome 或 Safari。')
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
      <div className="chat">
        <header className="chat-head">
          <button className="icon-btn back" onClick={onBack} aria-label="返回">
            <Icon name="back" />
          </button>
          <div className="chat-who-text">
            <span className="chat-name">{conv.title}</span>
          </div>
        </header>
        <div className="welcome">
          <div className="welcome-inner">
            <h2 style={{ fontSize: 24 }}>這段對話的角色已經不在了</h2>
            <p className="hint">角色被刪除後，對話還留著，但沒辦法繼續聊。可以回首頁開一段新的對話。</p>
          </div>
        </div>
      </div>
    )
  }

  const lead = chars[0]
  const bgSrc = single ? lead.background || lead.portrait : undefined
  const menuNode = menuId ? conv.nodes[menuId] : undefined
  const typingName = streaming ? charMap[streaming.speakerId]?.name : ''

  const stand = single && lead.portrait
  return (
    <div className={`chat ${stand ? 'has-stand' : ''}`}>
      <div
        className={`chat-bg ${lead.background ? '' : 'soft'}`}
        style={bgSrc ? { backgroundImage: `url(${bgSrc})` } : { display: 'none' }}
        aria-hidden="true"
      />
      {stand && <div className="stand" style={{ backgroundImage: `url(${lead.portrait})` }} aria-hidden="true" />}

      <header className="chat-head">
        <button className="icon-btn back" onClick={onBack} aria-label="返回">
          <Icon name="back" />
        </button>
        <button className="chat-who" onClick={() => setPanel(true)} aria-label="查看角色資訊">
          {single ? (
            <Avatar c={lead} size={42} />
          ) : (
            <span className="conv-avatars" style={{ width: 42, height: 42 }}>
              <Avatar c={chars[0]} size={32} />
              {chars[1] && <Avatar c={chars[1]} size={26} />}
            </span>
          )}
          <span className="chat-who-text">
            <span className="chat-name">{single ? lead.name : conv.title}</span>
            <span className="chat-sub">
              {streaming ? (
                <span className="typing-text">{single ? '正在輸入…' : `${typingName} 正在輸入…`}</span>
              ) : single ? (
                <>
                  <span className="stage-chip">{stage.name}</span>
                  <span>{mood ? `${mood}，相識第 ${days} 天` : `相識第 ${days} 天`}</span>
                </>
              ) : (
                <span>{chars.length} 位角色</span>
              )}
            </span>
          </span>
        </button>
        {single && (
          <span className="chat-affection" title={`好感 ${aff} / 100`}>
            <Droplet value={aff} size={30} />
            {aff}
          </span>
        )}
        <button className="icon-btn" onClick={() => setPanel(true)} aria-label="資訊面板">
          <Icon name="panel" />
        </button>
      </header>

      <main className="msgs" aria-live="polite">
        <div className="msgs-inner">
          {ctx.memory && (
            <span className="memory-note">
              <Icon name="memory" size={14} />
              較早的對話已收進記憶
            </span>
          )}

          {path.map((n, i) => {
            const sib = cm[n.parentId ?? 'ROOT'] ?? []
            const idx = sib.indexOf(n.id)
            const sp = n.speakerId ? charMap[n.speakerId] : undefined
            const prev = path[i - 1]
            const runStart = !prev || prev.role !== n.role || prev.speakerId !== n.speakerId
            const isLast = i === path.length - 1
            const fresh = n.ts > mountedAt.current
            return (
              <div
                key={n.id}
                id={`n-${n.id}`}
                className={`msg ${n.role} ${runStart ? 'run-start' : ''} ${fresh ? 'fresh' : ''}`}
              >
                {n.role === 'assistant' && (
                  <span className="msg-avatar">{runStart && <Avatar c={sp ?? lead} size={34} />}</span>
                )}
                <div className="msg-col">
                  {!single && n.role === 'assistant' && runStart && <span className="who">{sp?.name ?? '?'}</span>}
                  <button className={`bubble ${n.role}`} onClick={() => setMenuId(n.id)}>
                    {n.content}
                  </button>
                  {n.inner && (
                    <button
                      className={`inner ${openInner[n.id] ? 'open' : ''}`}
                      onClick={() => setOpenInner((o) => ({ ...o, [n.id]: !o[n.id] }))}
                      aria-expanded={!!openInner[n.id]}
                    >
                      <Icon name="drop" size={15} />
                      {openInner[n.id] ? <span className="inner-text">{n.inner}</span> : <span>心聲</span>}
                    </button>
                  )}
                  {(sib.length > 1 || (isLast && n.role === 'assistant' && !busy)) && (
                    <div className="msg-tools">
                      {sib.length > 1 && (
                        <>
                          <button
                            className="icon-btn"
                            onClick={() => switchBranch(sib[(idx - 1 + sib.length) % sib.length])}
                            aria-label="上一條分支"
                          >
                            <Icon name="back" size={15} />
                          </button>
                          <span className="branch-count">
                            {idx + 1}/{sib.length}
                          </span>
                          <button
                            className="icon-btn"
                            style={{ transform: 'scaleX(-1)' }}
                            onClick={() => switchBranch(sib[(idx + 1) % sib.length])}
                            aria-label="下一條分支"
                          >
                            <Icon name="back" size={15} />
                          </button>
                        </>
                      )}
                      {isLast && n.role === 'assistant' && !busy && (
                        <button className="icon-btn" onClick={() => void regenerate(n)} aria-label="重新生成" title="重新生成">
                          <Icon name="refresh" size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {streaming && (
            <div className="msg assistant run-start fresh">
              <span className="msg-avatar">
                <Avatar c={charMap[streaming.speakerId] ?? lead} size={34} />
              </span>
              <div className="msg-col">
                {!single && <span className="who">{typingName}</span>}
                {streaming.text ? (
                  <div className="bubble assistant">{streaming.text}</div>
                ) : (
                  <div className="bubble assistant typing" aria-label="正在輸入">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <div className="chat-error">{error}</div>}
          <div ref={endRef} />
        </div>
      </main>

      <footer className="composer">
        <div className="composer-inner">
          {callMode && (
            <span className="call-banner">
              <Icon name="phone" size={15} />
              {listening ? '正在聽你說…' : '通話中，說完會自動送出'}
            </span>
          )}
          <div className="composer-bar">
            <button className={`icon-btn ${listening && !callMode ? 'live' : ''}`} onClick={toggleMic} aria-label="語音輸入" title="語音輸入">
              <Icon name="mic" />
            </button>
            <button className={`icon-btn ${callMode ? 'live' : ''}`} onClick={toggleCall} aria-label={callMode ? '結束通話' : '開始通話'} title="通話模式">
              <Icon name="phone" />
            </button>
            <textarea
              rows={1}
              value={input}
              placeholder={single ? `對${lead.name}說…` : '說點什麼…'}
              aria-label="訊息"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            {busy ? (
              <button className="send stop" onClick={stop} aria-label="停止">
                <Icon name="stop" size={18} />
              </button>
            ) : (
              <button className="send" onClick={() => void send()} disabled={!input.trim()} aria-label="送出">
                <Icon name="send" size={19} />
              </button>
            )}
          </div>
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
          onDelete={onDelete}
          onClose={() => setPanel(false)}
        />
      )}

      {menuNode && (
        <Modal onClose={() => setMenuId(null)}>
          <p className="menu-preview">{menuNode.content}</p>
          <div className="menu">
            {menuNode.role === 'assistant' && (
              <button onClick={() => readAloud(menuNode.content)}>
                <Icon name="speaker" />
                朗讀
              </button>
            )}
            <button
              onClick={() => {
                setEditing({ id: menuNode.id, text: menuNode.content })
                setMenuId(null)
              }}
            >
              <Icon name="pen" />
              編輯這則
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(menuNode.content)
                setMenuId(null)
              }}
            >
              <Icon name="copy" />
              複製
            </button>
            {menuNode.role === 'assistant' ? (
              <button onClick={() => rewindTo(menuNode.id)}>
                <Icon name="rewind" />
                從這裡重來，開一條新分支
              </button>
            ) : (
              <button onClick={() => rewriteUser(menuNode)}>
                <Icon name="branch" />
                改寫這句，開一條新分支
              </button>
            )}
            <button className="danger" onClick={() => setConfirmRemove(menuNode.id)}>
              <Icon name="trash" />
              刪除這則和後面的分支
            </button>
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <Modal title="刪除這則訊息？" onClose={() => setConfirmRemove(null)}>
          <p className="hint">這則訊息和它後面的所有分支都會一起刪除，刪了就找不回來。</p>
          <div className="sheet-actions">
            <button className="btn quiet" onClick={() => setConfirmRemove(null)}>
              取消
            </button>
            <button className="btn danger" onClick={() => removeNode(confirmRemove)}>
              刪除
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="編輯訊息" onClose={() => setEditing(null)}>
          <textarea rows={6} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} autoFocus />
          <div className="sheet-actions">
            <button className="btn quiet" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="btn primary" onClick={saveEdit}>
              儲存
            </button>
          </div>
        </Modal>
      )}

    </div>
  )
}

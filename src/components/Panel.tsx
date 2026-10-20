import { useMemo, useState } from 'react'
import type { Character, Conversation, TNode } from '../types'
import { childMap, latestLeaf, STAGES, stageOf } from '../tree'
import type { ChildMap, Nodes } from '../tree'

interface Props {
  conv: Conversation
  path: TNode[]
  memory: { text: string; nodeId: string | null }
  chars: Character[]
  single: boolean
  aff: number
  onUpdate: (fn: (c: Conversation) => Conversation) => void
  onJump: (leaf: string) => void
  onScroll: (id: string) => void
  onEditChar: (id: string) => void
  onClose: () => void
}

type Tab = 'state' | 'tree' | 'search' | 'memory'

export default function Panel(p: Props) {
  const [tab, setTab] = useState<Tab>('state')
  const cm = useMemo(() => childMap(p.conv.nodes), [p.conv.nodes])
  const pathSet = useMemo(() => new Set(p.path.map((n) => n.id)), [p.path])

  return (
    <div className="overlay" onClick={p.onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="tabs inline">
            {(
              [
                ['state', '狀態'],
                ['tree', '劇情樹'],
                ['search', '搜尋'],
                ['memory', '記憶'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={p.onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {tab === 'state' && <StateTab {...p} />}
          {tab === 'tree' && (
            <TreeTab nodes={p.conv.nodes} cm={cm} pathSet={pathSet} onJump={(leaf) => { p.onJump(leaf); p.onClose() }} />
          )}
          {tab === 'search' && <SearchTab {...p} cm={cm} pathSet={pathSet} />}
          {tab === 'memory' && <MemoryTab {...p} />}
        </div>
      </aside>
    </div>
  )
}

function StateTab({ chars, single, aff, path, onEditChar }: Props) {
  if (!single) {
    return (
      <>
        <h3>群組成員</h3>
        {chars.map((c) => (
          <div key={c.id} className="card">
            <strong>{c.name}</strong>
            <p>{c.persona.slice(0, 60)}</p>
            <button onClick={() => onEditChar(c.id)}>編輯角色</button>
          </div>
        ))}
        <p className="hint">群組對話不計算好感度與回憶碎片。</p>
      </>
    )
  }

  const c = chars[0]
  const stage = stageOf(aff)
  return (
    <>
      <h3>關係：{stage.name}</h3>
      <div className="meter big"><i style={{ width: `${aff}%` }} /></div>
      <p className="hint">好感 {aff}/100　·　已聊 {path.length} 則</p>
      <div className="stages">
        {STAGES.map((s) => (
          <span key={s.name} className={aff >= s.min ? 'on' : ''}>{s.name} {s.min}</span>
        ))}
      </div>

      <h3>回憶碎片</h3>
      {c.fragments.length === 0 && <p className="hint">這個角色沒有設定回憶碎片，可以到角色編輯新增。</p>}
      {c.fragments.map((f) => {
        const open = aff >= f.unlockAt
        return (
          <div key={f.id} className={`card ${open ? '' : 'locked'}`}>
            <strong>{open ? '📖' : '🔒'} {open ? f.title : `好感度 ${f.unlockAt} 解鎖`}</strong>
            {open && <p>{f.content}</p>}
          </div>
        )
      })}

      <button onClick={() => onEditChar(c.id)}>編輯角色</button>
    </>
  )
}

function TreeTab({ nodes, cm, pathSet, onJump }: { nodes: Nodes; cm: ChildMap; pathSet: Set<string>; onJump: (leaf: string) => void }) {
  const roots = cm['ROOT'] ?? []
  if (!roots.length) return <p className="hint">還沒有任何訊息。</p>
  return (
    <>
      <p className="hint">每一個分岔都是一條世界線。點任一段落，切換到那條分支的最新位置。</p>
      {roots.map((r) => (
        <Seg key={r} startId={r} nodes={nodes} cm={cm} pathSet={pathSet} onJump={onJump} />
      ))}
    </>
  )
}

function Seg({ startId, nodes, cm, pathSet, onJump }: { startId: string; nodes: Nodes; cm: ChildMap; pathSet: Set<string>; onJump: (leaf: string) => void }) {
  const ids: string[] = []
  let cur = startId
  for (;;) {
    ids.push(cur)
    const ch = cm[cur]
    if (ch && ch.length === 1) cur = ch[0]
    else break
  }
  const last = ids[ids.length - 1]
  const kids = cm[last] ?? []
  const first = nodes[ids[0]]
  if (!first) return null
  const on = ids.some((i) => pathSet.has(i))

  return (
    <div>
      <button className={`seg ${on ? 'on' : ''}`} onClick={() => onJump(latestLeaf(cm, last))}>
        <b>{first.role === 'user' ? '我' : '她/他'}</b> {first.content.slice(0, 22)}
        {first.content.length > 22 ? '…' : ''} <em>{ids.length} 則</em>
      </button>
      {kids.length > 1 &&
        kids.map((k) => (
          <div key={k} className="indent">
            <Seg startId={k} nodes={nodes} cm={cm} pathSet={pathSet} onJump={onJump} />
          </div>
        ))}
      {kids.length === 1 && null}
    </div>
  )
}

function SearchTab({ conv, cm, pathSet, onJump, onScroll, onClose }: Props & { cm: ChildMap; pathSet: Set<string> }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    return Object.values(conv.nodes)
      .filter((n) => n.content.toLowerCase().includes(k))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 50)
  }, [q, conv.nodes])

  const go = (n: TNode) => {
    if (pathSet.has(n.id)) {
      onClose()
      setTimeout(() => onScroll(n.id), 50)
    } else {
      onJump(latestLeaf(cm, n.id))
      onClose()
      setTimeout(() => onScroll(n.id), 150)
    }
  }

  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋所有分支的訊息…" />
      {q.trim() && hits.length === 0 && <p className="hint">找不到。</p>}
      {hits.map((n) => (
        <button key={n.id} className="seg" onClick={() => go(n)}>
          <b>{n.role === 'user' ? '我' : '她/他'}</b> {n.content.slice(0, 40)}
          {!pathSet.has(n.id) && <em>其他分支</em>}
        </button>
      ))}
    </>
  )
}

function MemoryTab({ conv, memory, onUpdate }: Props) {
  const [auto, setAuto] = useState(memory.text)
  const [pinned, setPinned] = useState(conv.pinned)

  return (
    <>
      <h3>請角色記住</h3>
      <p className="hint">你手動寫的重點，所有分支都會帶著。例如：我的生日、我們的約定。</p>
      <textarea rows={5} value={pinned} onChange={(e) => setPinned(e.target.value)} />
      <button onClick={() => onUpdate((c) => ({ ...c, pinned }))}>儲存</button>

      <h3>自動記憶（這條分支）</h3>
      {memory.nodeId ? (
        <>
          <p className="hint">對話變長後，舊內容會被摘要成這份記憶。不同分支各自獨立，你可以直接修正。</p>
          <textarea rows={8} value={auto} onChange={(e) => setAuto(e.target.value)} />
          <button
            onClick={() =>
              onUpdate((c) => {
                const id = memory.nodeId as string
                return c.nodes[id] ? { ...c, nodes: { ...c.nodes, [id]: { ...c.nodes[id], memory: auto } } } : c
              })
            }
          >
            儲存
          </button>
        </>
      ) : (
        <p className="hint">這條分支還沒有自動記憶（未摘要的訊息超過 40 則才會開始）。</p>
      )}
    </>
  )
}

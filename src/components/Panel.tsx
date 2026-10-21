import { useEffect, useMemo, useState } from 'react'
import type { Character, Conversation, TNode } from '../types'
import { childMap, latestLeaf, STAGES, stageOf } from '../tree'
import type { ChildMap, Nodes } from '../tree'
import { fallbackArt } from '../look'
import Icon from './Icon'
import Avatar from './Avatar'
import Droplet from './Droplet'

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
  onDelete: () => void
  onClose: () => void
}

type Tab = 'state' | 'tree' | 'search' | 'memory'

const TABS: [Tab, string][] = [
  ['state', '關係'],
  ['tree', '劇情樹'],
  ['search', '搜尋'],
  ['memory', '記憶'],
]

export default function Panel(p: Props) {
  const [tab, setTab] = useState<Tab>('state')
  const cm = useMemo(() => childMap(p.conv.nodes), [p.conv.nodes])
  const pathSet = useMemo(() => new Set(p.path.map((n) => n.id)), [p.path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  return (
    <div className="drawer-overlay" onClick={p.onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="對話資訊" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="segmented" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="關閉">
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer-body">
          {tab === 'state' && <StateTab {...p} />}
          {tab === 'tree' && (
            <TreeTab
              nodes={p.conv.nodes}
              cm={cm}
              pathSet={pathSet}
              onJump={(leaf) => {
                p.onJump(leaf)
                p.onClose()
              }}
            />
          )}
          {tab === 'search' && <SearchTab {...p} cm={cm} pathSet={pathSet} />}
          {tab === 'memory' && <MemoryTab {...p} />}
          {tab === 'state' && (
            <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <button className="btn danger small" onClick={p.onDelete}>
                <Icon name="trash" size={16} />
                刪除這段對話
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function StateTab({ chars, single, aff, path, onEditChar }: Props) {
  if (!single) {
    return (
      <>
        <p className="hint">群組對話不計算好感度和回憶碎片。</p>
        {chars.map((c) => (
          <div key={c.id} className="panel-card" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar c={c} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong className="voice" style={{ fontSize: 17 }}>
                {c.name}
              </strong>
              <p className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.persona}
              </p>
            </div>
            <button className="icon-btn" onClick={() => onEditChar(c.id)} aria-label={`編輯${c.name}`}>
              <Icon name="pen" size={18} />
            </button>
          </div>
        ))}
      </>
    )
  }

  const c = chars[0]
  const stage = stageOf(aff)
  const next = STAGES.find((s) => s.min > aff)
  const art = c.portrait || c.avatar
  const unlocked = c.fragments.filter((f) => aff >= f.unlockAt).length

  return (
    <>
      <div
        className="art-dim"
        style={{
          height: 180,
          margin: '0 -20px',
          backgroundImage: art ? `url(${art})` : fallbackArt(c.name),
          backgroundSize: 'cover',
          backgroundPosition: 'center 20%',
          maskImage: 'linear-gradient(180deg, #000 40%, transparent)',
          WebkitMaskImage: 'linear-gradient(180deg, #000 40%, transparent)',
        }}
        aria-hidden="true"
      />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -70, gap: 12 }}>
        <div>
          <h2 className="voice" style={{ fontSize: 30, lineHeight: 1.15 }}>
            {c.name}
          </h2>
          <p className="hint">已聊 {path.length} 則</p>
        </div>
        <button className="btn small" onClick={() => onEditChar(c.id)}>
          <Icon name="pen" size={16} />
          編輯角色
        </button>
      </div>

      <div className="relation">
        <Droplet value={aff} size={64} showDelta={false} />
        <div>
          <h3>{stage.name}</h3>
          <p>
            好感 {aff} / 100
            {next ? `，再 ${next.min - aff} 點進入「${next.name}」` : '，已經是最深的羈絆'}
          </p>
        </div>
        <div className="stage-track" aria-hidden="true">
          {STAGES.map((s) => (
            <span key={s.name} className={aff >= s.min ? 'on' : ''}>
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div className="section-head" style={{ margin: '8px 0 -4px' }}>
        <h2>回憶碎片</h2>
        {c.fragments.length > 0 && (
          <span className="count">
            {unlocked} / {c.fragments.length}
          </span>
        )}
      </div>
      {c.fragments.length === 0 && <p className="hint">這位角色還沒有回憶碎片。到「編輯角色」可以新增。</p>}
      {[...c.fragments]
        .sort((a, b) => a.unlockAt - b.unlockAt)
        .map((f) => {
          const open = aff >= f.unlockAt
          return (
            <div key={f.id} className={`fragment ${open ? '' : 'locked'}`}>
              <h4>
                <Icon name={open ? 'memory' : 'lock'} size={16} />
                {open ? f.title : `好感 ${f.unlockAt} 時解鎖`}
              </h4>
              {open && <p>{f.content}</p>}
            </div>
          )
        })}
    </>
  )
}

function TreeTab({ nodes, cm, pathSet, onJump }: { nodes: Nodes; cm: ChildMap; pathSet: Set<string>; onJump: (leaf: string) => void }) {
  const roots = cm['ROOT'] ?? []
  if (!roots.length) return <p className="hint">還沒有任何訊息。</p>
  return (
    <>
      <p className="hint">每個分岔都是一條世界線，各自有自己的好感和記憶。點一段就切換過去，亮起的是你現在所在的那條。</p>
      <div>
        {roots.map((r) => (
          <Seg key={r} startId={r} nodes={nodes} cm={cm} pathSet={pathSet} onJump={onJump} />
        ))}
      </div>
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
      <button className={`tree-seg ${on ? 'on' : ''}`} onClick={() => onJump(latestLeaf(cm, last))}>
        <b>{first.role === 'user' ? '你' : '對方'}</b>
        <span className="seg-text">{first.content}</span>
        <em>{ids.length} 則</em>
      </button>
      {kids.length > 1 &&
        kids.map((k) => (
          <div key={k} className="indent">
            <Seg startId={k} nodes={nodes} cm={cm} pathSet={pathSet} onJump={onJump} />
          </div>
        ))}
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
      <label className="field">
        <span className="sr-only">搜尋</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋所有分支裡的訊息" autoFocus />
      </label>
      {q.trim() && hits.length === 0 && <p className="hint">找不到「{q.trim()}」。換個關鍵字試試。</p>}
      <div>
        {hits.map((n) => (
          <button key={n.id} className="tree-seg" onClick={() => go(n)}>
            <b>{n.role === 'user' ? '你' : '對方'}</b>
            <span className="seg-text">{n.content}</span>
            {!pathSet.has(n.id) && <em>其他分支</em>}
          </button>
        ))}
      </div>
    </>
  )
}

function MemoryTab({ conv, memory, onUpdate }: Props) {
  const [auto, setAuto] = useState(memory.text)
  const [pinned, setPinned] = useState(conv.pinned)
  const [saved, setSaved] = useState<'pin' | 'auto' | null>(null)

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(null), 1800)
    return () => clearTimeout(t)
  }, [saved])

  return (
    <>
      <div className="panel-card">
        <h3>
          <Icon name="heart" size={17} />
          請對方記住
        </h3>
        <p className="hint">你親手寫下的重點，每條分支都會帶著。例如你的生日、你們的約定。</p>
        <textarea rows={5} value={pinned} onChange={(e) => setPinned(e.target.value)} placeholder="我的生日是 5 月 21 日" />
        <div>
          <button
            className="btn small"
            disabled={pinned === conv.pinned}
            onClick={() => {
              onUpdate((c) => ({ ...c, pinned }))
              setSaved('pin')
            }}
          >
            {saved === 'pin' ? '已儲存' : '儲存'}
          </button>
        </div>
      </div>

      <div className="panel-card">
        <h3>
          <Icon name="memory" size={17} />
          自動記憶
        </h3>
        {memory.nodeId ? (
          <>
            <p className="hint">對話變長後，較早的內容會整理成這份筆記。只屬於這條分支，寫錯可以直接改。</p>
            <textarea rows={8} value={auto} onChange={(e) => setAuto(e.target.value)} />
            <div>
              <button
                className="btn small"
                disabled={auto === memory.text}
                onClick={() => {
                  onUpdate((c) => {
                    const id = memory.nodeId as string
                    return c.nodes[id] ? { ...c, nodes: { ...c.nodes, [id]: { ...c.nodes[id], memory: auto } } } : c
                  })
                  setSaved('auto')
                }}
              >
                {saved === 'auto' ? '已儲存' : '儲存'}
              </button>
            </div>
          </>
        ) : (
          <p className="hint">這條分支聊超過 40 則之後，才會開始整理自動記憶。</p>
        )}
      </div>
    </>
  )
}

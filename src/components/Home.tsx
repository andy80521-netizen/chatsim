import { useRef, useState } from 'react'
import type { Character, Conversation, Settings } from '../types'
import { exportCharacter, parseCharacterFile } from '../characters'
import type { CharForm } from '../characters'
import { TEMPLATES } from '../templates'
import Modal from './Modal'
import SettingsPanel from './SettingsPanel'

import type { User } from 'firebase/auth'

interface Props {
  characters: Character[]
  convs: Conversation[]
  settings: Settings
  achv: Record<string, number>
  onOpenConv: (id: string) => void
  onNewConv: (ids: string[]) => void
  onDeleteConv: (id: string) => void
  onEditChar: (id: string | null) => void
  onAddChars: (list: Character[]) => void
  onSaveSettings: (s: Settings) => void
  onExportAll: () => void
  onImportAll: (f: File) => void
  normalize: (c: Partial<Character>) => Character
  currentUser: User | null
  onLogin: () => void
  onLogout: () => void
}

type Tab = 'chats' | 'chars' | 'tpl' | 'settings'

export default function Home(p: Props) {
  const [tab, setTab] = useState<Tab>('chats')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const lastText = (c: Conversation) => {
    const nodes = Object.values(c.nodes)
    const cur = c.leafId ? c.nodes[c.leafId] : undefined
    return (cur ?? nodes[nodes.length - 1])?.content.slice(0, 36) ?? '尚無對話'
  }

  const importFile = async (f: File) => {
    try {
      const list = parseCharacterFile(await f.text())
      if (list.length) p.onAddChars(list)
    } catch {
      alert('檔案格式不正確')
    }
  }

  const addTemplate = (t: CharForm) => p.onAddChars([p.normalize(t)])

  return (
    <div className="screen">
      <header className="bar">
        <h1>ChatSim</h1>
        {tab === 'chats' && (
          <button className="ghost" onClick={() => setPicking(true)}>＋ 新對話</button>
        )}
        {tab === 'chars' && (
          <div>
            <button className="ghost" onClick={() => fileRef.current?.click()}>匯入</button>
            <button className="ghost" onClick={() => p.onEditChar(null)}>＋ 新角色</button>
          </div>
        )}
      </header>

      <main className="list">
        {tab === 'chats' && (
          <>
            {p.convs.length === 0 && (
              <p className="empty">還沒有對話。先到「角色」或「模板」準備角色，再按右上角「＋ 新對話」。</p>
            )}
            {[...p.convs]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((c) => (
                <div key={c.id} className="row">
                  <button className="row-main" onClick={() => p.onOpenConv(c.id)}>
                    <div className="avatar">{c.title.slice(0, 1)}</div>
                    <div className="row-text">
                      <strong>
                        {c.title}
                        {c.characterIds.length > 1 && <em className="tag">群組</em>}
                      </strong>
                      <span>{lastText(c)}</span>
                    </div>
                  </button>
                  <button className="ghost small" onClick={() => p.onDeleteConv(c.id)}>✕</button>
                </div>
              ))}
          </>
        )}

        {tab === 'chars' && (
          <>
            {p.characters.length === 0 && <p className="empty">還沒有角色。按「＋ 新角色」，或到「模板」加入現成的。</p>}
            {p.characters.map((c) => (
              <div key={c.id} className="row">
                <button className="row-main" onClick={() => p.onEditChar(c.id)}>
                  <div className="avatar">{c.name.slice(0, 1)}</div>
                  <div className="row-text">
                    <strong>{c.name}</strong>
                    <span>{c.persona.slice(0, 36) || '（未設定）'}</span>
                  </div>
                </button>
                <button className="ghost small" onClick={() => exportCharacter(c)}>匯出</button>
              </div>
            ))}
          </>
        )}

        {tab === 'tpl' && (
          <>
            <p className="hint">內建模板，加入後可以自由修改。也可以在「角色」分頁匯入朋友分享的角色檔。</p>
            {TEMPLATES.map((t) => (
              <div key={t.name} className="card">
                <strong>{t.name}</strong>
                <p>{t.persona.slice(0, 90)}…</p>
                <button onClick={() => addTemplate(t)}>加入我的角色</button>
              </div>
            ))}
          </>
        )}

        {tab === 'settings' && (
          <SettingsPanel
            settings={p.settings}
            achv={p.achv}
            onSave={p.onSaveSettings}
            onExportAll={p.onExportAll}
            onImportAll={p.onImportAll}
            currentUser={p.currentUser}
            onLogin={p.onLogin}
            onLogout={p.onLogout}
          />
        )}
      </main>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importFile(f)
          e.target.value = ''
        }}
      />

      <nav className="tabs">
        {(
          [
            ['chats', '對話'],
            ['chars', '角色'],
            ['tpl', '模板'],
            ['settings', '設定'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {picking && (
        <Modal title="選擇角色（選 2 個以上 = 群組對話）" onClose={() => setPicking(false)}>
          {p.characters.length === 0 && <p className="hint">還沒有角色，請先建立。</p>}
          {p.characters.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
              />
              {c.name}
            </label>
          ))}
          <button
            className="primary"
            disabled={!picked.length}
            onClick={() => {
              p.onNewConv(picked)
              setPicked([])
              setPicking(false)
            }}
          >
            開始
          </button>
        </Modal>
      )}
    </div>
  )
}

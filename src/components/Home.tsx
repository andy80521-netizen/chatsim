import { useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Character, Conversation, Settings, ThemeMode } from '../types'
import { exportCharacter, parseCharacterFile } from '../characters'
import type { CharForm } from '../characters'
import { TEMPLATES } from '../templates'
import { affectionOf, pathTo, stageOf } from '../tree'
import { fallbackArt, relTime } from '../look'
import Modal from './Modal'
import SettingsPanel from './SettingsPanel'
import Icon, { type IconName } from './Icon'
import Avatar from './Avatar'
import Droplet from './Droplet'

interface Props {
  characters: Character[]
  convs: Conversation[]
  settings: Settings
  achv: Record<string, number>
  activeConvId: string | null
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
  onToast: (msg: string) => void
}

type Tab = 'chats' | 'chars' | 'tpl' | 'settings'

const TABS: [Tab, string, IconName][] = [
  ['chats', '對話', 'chat'],
  ['chars', '角色', 'people'],
  ['tpl', '模板', 'spark'],
  ['settings', '設定', 'sliders'],
]

const TITLE: Record<Tab, string> = { chats: '對話', chars: '角色', tpl: '模板', settings: '設定' }

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON: Record<ThemeMode, IconName> = { system: 'auto', light: 'sun', dark: 'moon' }
const THEME_LABEL: Record<ThemeMode, string> = { system: '跟隨系統', light: '淺色', dark: '深色' }

export function DropLogo({ className = 'droplet-logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 32" aria-hidden="true">
      <path fill="currentColor" d="M12 1.6C16.6 8 21 13 21 19.6a9 9 0 01-18 0C3 13 7.4 8 12 1.6z" />
      <path d="M8.2 13.5c-.9 1.6-1.4 3.3-1.4 4.9" fill="none" stroke="rgb(255 255 255 / .7)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function Face({ c, aff, onClick }: { c: Character; aff: number | null; onClick: () => void }) {
  return (
    <button className="face" onClick={onClick} aria-label={`和${c.name}聊天`}>
      <span className="face-ring" style={{ ['--p' as string]: `${aff ?? 0}%` }} data-new={aff === null || undefined}>
        <Avatar c={c} size={56} />
      </span>
      <span className="face-name">{c.name}</span>
    </button>
  )
}

function PortraitCard({ c, aff, onClick }: { c: Character; aff: number | null; onClick: () => void }) {
  const art = c.portrait || c.avatar
  return (
    <button
      className="card-portrait"
      style={{ backgroundImage: art ? `url(${art})` : fallbackArt(c.name) }}
      onClick={onClick}
      aria-label={`和${c.name}聊天`}
    >
      {!art && <span className="initial">{c.name.slice(0, 1)}</span>}
      {aff !== null && (
        <span className="drop-corner">
          <Droplet value={aff} size={22} showDelta={false} />
        </span>
      )}
      <span className="meta">
        <span className="name">{c.name}</span>
        <span className="stage-tag">{aff === null ? '還沒聊過' : stageOf(aff).name}</span>
      </span>
    </button>
  )
}

export default function Home(p: Props) {
  const [tab, setTab] = useState<Tab>('chats')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const chars = useMemo(() => [...p.characters].sort((a, b) => a.createdAt - b.createdAt), [p.characters])
  const charMap = useMemo(() => Object.fromEntries(p.characters.map((c) => [c.id, c])), [p.characters])
  const convs = useMemo(() => [...p.convs].sort((a, b) => b.updatedAt - a.updatedAt), [p.convs])

  // 每個角色最近一次 1 對 1 對話，用來顯示好感與快速進入
  const soloConv = useMemo(() => {
    const m: Record<string, Conversation> = {}
    for (const c of convs) if (c.characterIds.length === 1 && !m[c.characterIds[0]]) m[c.characterIds[0]] = c
    return m
  }, [convs])
  const affOf = (charId: string) => {
    const c = soloConv[charId]
    return c ? affectionOf(pathTo(c.nodes, c.leafId)) : null
  }

  const talkTo = (charId: string) => {
    const c = soloConv[charId]
    if (c) p.onOpenConv(c.id)
    else p.onNewConv([charId])
  }

  const lastText = (c: Conversation) => {
    const cur = c.leafId ? c.nodes[c.leafId] : undefined
    if (!cur) return '還沒有訊息'
    const who = cur.role === 'user' ? '你：' : ''
    return who + cur.content.replace(/\s+/g, ' ').slice(0, 40)
  }

  const importFile = async (f: File) => {
    try {
      const list = parseCharacterFile(await f.text())
      if (list.length) p.onAddChars(list)
    } catch {
      p.onToast('這不是 ChatSim 的角色檔，請選擇 .chatsim.json 檔案')
    }
  }

  const addTemplate = (t: CharForm) => p.onAddChars([p.normalize(t)])
  const theme = p.settings.theme ?? 'system'

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="page-title">
          <DropLogo />
          {TITLE[tab]}
        </h1>
        <div className="home-head-actions">
          <button
            className="icon-btn"
            onClick={() => p.onSaveSettings({ ...p.settings, theme: NEXT_THEME[theme] })}
            aria-label={`外觀：${THEME_LABEL[theme]}，點一下切換`}
            title={`外觀：${THEME_LABEL[theme]}`}
          >
            <Icon name={THEME_ICON[theme]} />
          </button>
          {tab === 'chats' && (
            <button className="icon-btn" onClick={() => setPicking(true)} aria-label="新對話" title="新對話">
              <Icon name="plus" />
            </button>
          )}
          {tab === 'chars' && (
            <>
              <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="匯入角色檔" title="匯入角色檔">
                <Icon name="upload" />
              </button>
              <button className="icon-btn" onClick={() => p.onEditChar(null)} aria-label="新增角色" title="新增角色">
                <Icon name="plus" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="home-body">
        {tab === 'chats' && (
          <>
            <section className="section">
              <div className="section-head">
                <h2 className="label">想和誰說話</h2>
              </div>
              {chars.length === 0 ? (
                <div className="empty">
                  <h3>先找一位角色</h3>
                  <p className="hint">從模板挑一位現成的，或自己寫一位。一句話描述也行，AI 會幫你補完。</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn primary small" onClick={() => setTab('tpl')}>
                      看看模板
                    </button>
                    <button className="btn small" onClick={() => p.onEditChar(null)}>
                      自己建立
                    </button>
                  </div>
                </div>
              ) : (
                <div className="faces">
                  {chars.map((c) => (
                    <Face key={c.id} c={c} aff={affOf(c.id)} onClick={() => talkTo(c.id)} />
                  ))}
                  <button className="face" onClick={() => p.onEditChar(null)} aria-label="新增角色">
                    <span className="face-ring face-add">
                      <Icon name="plus" size={22} />
                    </span>
                    <span className="face-name">新角色</span>
                  </button>
                </div>
              )}
            </section>

            {convs.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2 className="label">全部對話</h2>
                </div>
                <div className="conv-list">
                  {convs.map((c) => {
                    const members = c.characterIds.map((id) => charMap[id]).filter(Boolean) as Character[]
                    const group = c.characterIds.length > 1
                    const aff = group ? null : affectionOf(pathTo(c.nodes, c.leafId))
                    return (
                      <div key={c.id} className="conv-row">
                        <button
                          className={`conv ${p.activeConvId === c.id ? 'on' : ''}`}
                          onClick={() => p.onOpenConv(c.id)}
                          aria-current={p.activeConvId === c.id ? 'true' : undefined}
                        >
                          <span className="conv-avatars">
                            {group ? (
                              <>
                                <Avatar c={members[0]} name={c.title} size={34} />
                                <Avatar c={members[1]} name={c.title.slice(1)} size={28} />
                              </>
                            ) : (
                              <Avatar c={members[0]} name={c.title} size={50} />
                            )}
                          </span>
                          <span className="conv-text">
                            <span className="conv-top">
                              <span className="conv-title">{c.title}</span>
                              {group && <span className="group-tag">群組</span>}
                              <span className="conv-time" style={{ marginLeft: 'auto' }}>
                                {relTime(c.updatedAt)}
                              </span>
                            </span>
                            <span className="conv-last">{lastText(c)}</span>
                            {aff !== null && (
                              <span className="conv-aff" aria-label={`好感 ${aff}`}>
                                <span className="conv-aff-bar">
                                  <i style={{ width: `${aff}%` }} />
                                </span>
                                <span className="conv-aff-num">{aff}</span>
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          className="icon-btn conv-del"
                          style={{ position: 'absolute', right: 4 }}
                          onClick={() => p.onDeleteConv(c.id)}
                          aria-label={`刪除「${c.title}」對話`}
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'chars' && (
          <section className="section">
            <p className="hint" style={{ marginBottom: 12 }}>
              {chars.length ? `${chars.length} 位角色，點卡片編輯。` : ''}
            </p>
            {chars.length === 0 ? (
              <div className="empty">
                <h3>還沒有角色</h3>
                <p className="hint">按右上角的加號建立，或匯入朋友分享的角色檔。</p>
              </div>
            ) : (
              <div className="cast-grid">
                {chars.map((c) => (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <PortraitCard c={c} aff={affOf(c.id)} onClick={() => p.onEditChar(c.id)} />
                    <button className="btn quiet small" onClick={() => exportCharacter(c)} aria-label={`匯出${c.name}的角色檔`}>
                      <Icon name="download" size={15} />
                      匯出
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'tpl' && (
          <section className="section">
            <p className="hint" style={{ marginBottom: 16 }}>
              加入後就是你的角色，可以隨意改名字、個性和圖片。
            </p>
            {TEMPLATES.map((t) => (
              <article key={t.name} className="tpl">
                <div className="tpl-art" style={{ backgroundImage: fallbackArt(t.name) }} aria-hidden="true">
                  {t.name.slice(0, 1)}
                </div>
                <div className="tpl-body">
                  <h3>{t.name}</h3>
                  <p>{t.persona}</p>
                  <button className="btn small" onClick={() => addTemplate(t)}>
                    <Icon name="plus" size={16} />
                    加入我的角色
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        {tab === 'settings' && (
          <section className="section">
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
          </section>
        )}
      </div>

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

      <nav className="tabs" aria-label="主選單">
        {TABS.map(([k, label, icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span className="tab-ico">
              <Icon name={icon} size={21} />
            </span>
            {label}
          </button>
        ))}
      </nav>

      {picking && (
        <Modal title="和誰聊？" onClose={() => setPicking(false)}>
          <p className="hint">選一位是一對一，選兩位以上就是群組對話。</p>
          {chars.length === 0 && <p className="hint">還沒有角色，先到「模板」加入一位。</p>}
          <div>
            {chars.map((c) => (
              <label key={c.id} className="pick">
                <Avatar c={c} size={40} />
                <span>{c.name}</span>
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                />
              </label>
            ))}
          </div>
          <div className="sheet-actions">
            <button
              className="btn primary block"
              disabled={!picked.length}
              onClick={() => {
                p.onNewConv(picked)
                setPicked([])
                setPicking(false)
              }}
            >
              {picked.length > 1 ? `開始群組對話（${picked.length} 位）` : '開始對話'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

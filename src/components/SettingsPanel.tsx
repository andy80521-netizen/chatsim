import { useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Settings, ThemeMode } from '../types'
import { ACHIEVEMENTS } from '../achievements'
import Icon, { type IconName } from './Icon'

interface Props {
  settings: Settings
  achv: Record<string, number>
  onSave: (s: Settings) => void
  onExportAll: () => void
  onImportAll: (f: File) => void
  currentUser: User | null
  onLogin: () => void
  onLogout: () => void
}

const THEMES: [ThemeMode, string, IconName][] = [
  ['system', '跟隨系統', 'auto'],
  ['light', '晨蜜', 'sun'],
  ['dark', '夜夢', 'moon'],
]

export default function SettingsPanel({
  settings,
  achv,
  onSave,
  onExportAll,
  onImportAll,
  currentUser,
  onLogin,
  onLogout,
}: Props) {
  const [s, setS] = useState(settings)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  const dirty =
    s.apiKey !== settings.apiKey ||
    s.model !== settings.model ||
    s.lang !== settings.lang ||
    s.ttsAuto !== settings.ttsAuto ||
    s.greetAfterHours !== settings.greetAfterHours
  const got = Object.keys(achv).length

  return (
    <div className="settings">
      <div className="panel-card">
        <h3>
          <Icon name="cloud" size={18} />
          雲端同步
        </h3>
        {currentUser ? (
          <>
            <div className="account">
              <span className="sync-dot" aria-hidden="true" />
              <div className="account-text">
                <strong>{currentUser.email}</strong>
                <span className="hint">角色、對話和成就會在登入這個帳號的裝置之間同步。</span>
              </div>
            </div>
            <div>
              <button className="btn danger small" onClick={onLogout}>
                登出
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">目前只存在這個瀏覽器。登入 Google 帳號後，手機和電腦就能看到同一份資料。</p>
            <div>
              <button className="btn primary" onClick={onLogin}>
                用 Google 帳號登入
              </button>
            </div>
          </>
        )}
      </div>

      <div className="panel-card">
        <h3>外觀</h3>
        <div className="segmented" role="radiogroup" aria-label="外觀">
          {THEMES.map(([k, label, icon]) => (
            <button
              key={k}
              role="radio"
              aria-checked={settings.theme === k}
              className={settings.theme === k ? 'on' : ''}
              onClick={() => onSave({ ...settings, theme: k })}
            >
              <Icon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-card">
        <h3>AI 模型</h3>
        <label className="field">
          <span>Gemini API Key</span>
          <input type="password" value={s.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="AIza 開頭的金鑰" />
          <small>只存在這個瀏覽器，不會上傳到雲端。換裝置時要再填一次。</small>
        </label>
        <label className="field">
          <span>模型</span>
          <input value={s.model} onChange={(e) => set('model', e.target.value.trim())} />
        </label>
      </div>

      <div className="panel-card">
        <h3>語音與陪伴</h3>
        <label className="field">
          <span>語音語言</span>
          <select value={s.lang} onChange={(e) => set('lang', e.target.value)}>
            <option value="zh-TW">中文（台灣）</option>
            <option value="en-US">English (US)</option>
            <option value="en-AU">English (AU)</option>
            <option value="ja-JP">日本語</option>
          </select>
        </label>
        <label className="switch">
          <span className="switch-text">
            角色回覆後自動朗讀
            <small>用瀏覽器內建的語音</small>
          </span>
          <input type="checkbox" checked={s.ttsAuto} onChange={(e) => set('ttsAuto', e.target.checked)} />
        </label>
        <label className="field">
          <span>隔幾小時沒來，角色會先打招呼</span>
          <input
            type="number"
            min={0}
            value={s.greetAfterHours}
            onChange={(e) => set('greetAfterHours', Math.max(0, Number(e.target.value) || 0))}
          />
          <small>填 0 就關閉。</small>
        </label>
      </div>

      <button className="btn primary block" disabled={!dirty} onClick={() => onSave({ ...s, theme: settings.theme })}>
        {dirty ? '儲存設定' : '設定已儲存'}
      </button>

      <div className="panel-card">
        <h3>備份</h3>
        <p className="hint">把所有角色、對話和成就存成一個檔案，或從檔案還原。還原會覆蓋現有資料。</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={onExportAll}>
            <Icon name="download" size={16} />
            匯出備份
          </button>
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            從備份還原
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportAll(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="panel-card">
        <h3>
          <Icon name="trophy" size={18} />
          成就
          <span className="faint" style={{ fontWeight: 400, marginLeft: 'auto', fontSize: 13 }}>
            {got} / {ACHIEVEMENTS.length}
          </span>
        </h3>
        <div className="achv-grid">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.id} className={`achv-item ${achv[a.id] ? 'got' : ''}`}>
              <strong>
                <Icon name={achv[a.id] ? 'trophy' : 'lock'} size={15} />
                {a.title}
              </strong>
              <span>{a.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

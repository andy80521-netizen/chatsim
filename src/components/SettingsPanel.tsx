import { useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Settings } from '../types'
import { ACHIEVEMENTS } from '../achievements'

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

  return (
    <div className="form">
      <div className="card">
        <strong>☁️ 雲端同步</strong>
        {currentUser ? (
          <>
            <p>已登入 Google 帳號：<strong>{currentUser.email}</strong></p>
            <p className="hint">角色、對話與成就將在登入同一帳號的手機與電腦間即時同步。</p>
            <div>
              <button className="small danger" onClick={onLogout}>登出帳號</button>
            </div>
          </>
        ) : (
          <>
            <p>目前為<strong>本機模式</strong>（資料儲存於瀏覽器 localStorage）。</p>
            <p className="hint">登入 Google 帳號後，可以在手機與電腦之間即時同步對話、角色與成就。</p>
            <div>
              <button className="primary" onClick={onLogin}>使用 Google 帳號登入</button>
            </div>
          </>
        )}
      </div>

      <hr />

      <label>
        Gemini API Key
        <input type="password" value={s.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="AIza..." />
      </label>
      <p className="hint">
        Key 只存在這個瀏覽器的 localStorage，請求直接從瀏覽器送給 Google。自用沒問題；若要公開部署，請改成經過後端轉送。
      </p>
      <label>
        模型
        <input value={s.model} onChange={(e) => set('model', e.target.value.trim())} />
      </label>

      <label>
        語音語言（朗讀與語音輸入）
        <select value={s.lang} onChange={(e) => set('lang', e.target.value)}>
          <option value="zh-TW">中文（台灣）</option>
          <option value="en-US">English (US)</option>
          <option value="en-AU">English (AU)</option>
          <option value="ja-JP">日本語</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.ttsAuto} onChange={(e) => set('ttsAuto', e.target.checked)} />
        角色回覆後自動朗讀
      </label>
      <label>
        隔多久回來，角色主動打招呼（小時，0 = 關閉）
        <input
          type="number"
          min={0}
          value={s.greetAfterHours}
          onChange={(e) => set('greetAfterHours', Math.max(0, Number(e.target.value) || 0))}
        />
      </label>

      <button className="primary" onClick={() => onSave(s)}>儲存設定</button>

      <hr />
      <button onClick={onExportAll}>匯出全部備份（JSON）</button>
      <button onClick={() => fileRef.current?.click()}>匯入備份</button>
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

      <hr />
      <h3>成就（{Object.keys(achv).length}/{ACHIEVEMENTS.length}）</h3>
      <div className="achv">
        {ACHIEVEMENTS.map((a) => (
          <div key={a.id} className={achv[a.id] ? 'got' : ''}>
            <strong>{achv[a.id] ? '🏆' : '🔒'} {a.title}</strong>
            <span>{a.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

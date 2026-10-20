import { useRef, useState } from 'react'
import type { Settings } from '../types'
import { ACHIEVEMENTS } from '../achievements'

interface Props {
  settings: Settings
  achv: Record<string, number>
  onSave: (s: Settings) => void
  onExportAll: () => void
  onImportAll: (f: File) => void
}

export default function SettingsPanel({ settings, achv, onSave, onExportAll, onImportAll }: Props) {
  const [s, setS] = useState(settings)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })

  return (
    <div className="form">
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

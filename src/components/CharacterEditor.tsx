import { useEffect, useState } from 'react'
import { blankForm, CharForm } from '../characters'
import { generateCharacter } from '../llm'
import { Character, Settings, uid } from '../types'

interface Props {
  initial: Character | null
  settings: Settings
  onSave: (c: Character) => void
  onCancel: () => void
  onDelete?: () => void
}

const DRAFT_KEY = 'chatsim2.draft'

function loadDraft(): CharForm | null {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
  } catch {
    return null
  }
}

export default function CharacterEditor({ initial, settings, onSave, onCancel, onDelete }: Props) {
  const [form, setForm] = useState<CharForm>(() => {
    if (initial) {
      const { id: _id, createdAt: _t, ...rest } = initial
      void _id
      void _t
      return rest
    }
    return loadDraft() ?? blankForm()
  })
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)

  // 新角色：自動儲存草稿
  useEffect(() => {
    if (initial) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {
      /* ignore */
    }
  }, [form, initial])

  const set = <K extends keyof CharForm>(k: K, v: CharForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return alert('請輸入角色暱稱')
    if (!initial) localStorage.removeItem(DRAFT_KEY)
    onSave({
      ...form,
      id: initial?.id ?? uid(),
      name: form.name.trim(),
      createdAt: initial?.createdAt ?? Date.now(),
    })
  }

  const aiFill = async () => {
    if (!idea.trim()) return
    setBusy(true)
    try {
      const d = await generateCharacter(settings, idea.trim())
      setForm({
        ...form,
        name: d.name || form.name,
        userName: d.userName || form.userName,
        persona: d.persona || form.persona,
        greeting: d.greeting || form.greeting,
        innerVoice: true,
        fragments: (d.fragments ?? []).map((f) => ({
          id: uid(),
          title: f.title,
          content: f.content,
          unlockAt: Number(f.unlockAt) || 0,
        })),
      })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <header className="bar">
        <button className="ghost" onClick={onCancel}>{initial ? '取消' : '返回'}</button>
        <h1>{initial ? '編輯角色' : '新增角色'}</h1>
        <button className="ghost" onClick={submit}>儲存</button>
      </header>

      <main className="form">
        {!initial && <p className="hint">草稿會自動儲存，離開後再回來還在。</p>}

        <label>
          一句話想法 → AI 幫我寫完整角色卡
          <div className="inputrow">
            <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="例如：嘴硬心軟的圖書館管理員" />
            <button onClick={aiFill} disabled={busy || !idea.trim()}>{busy ? '產生中…' : '產生'}</button>
          </div>
        </label>

        <label>
          角色暱稱
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：小夢" />
        </label>
        <label>
          角色怎麼稱呼你
          <input value={form.userName} onChange={(e) => set('userName', e.target.value)} placeholder="例如：Andy" />
        </label>
        <label>
          角色設定（性格、口吻、背景、和你的關係）
          <textarea rows={7} value={form.persona} onChange={(e) => set('persona', e.target.value)} />
        </label>
        <label>
          前書（角色的第一句話，會強烈影響後續口吻）
          <textarea rows={3} value={form.greeting} onChange={(e) => set('greeting', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={form.innerVoice} onChange={(e) => set('innerVoice', e.target.checked)} />
          顯示內心戲（只有你看得到的角色內心獨白）
        </label>

        <h3>回憶碎片</h3>
        <p className="hint">好感度達到門檻才會解鎖；解鎖後角色才知道並會在合適時機提起。</p>
        {form.fragments.map((f, i) => (
          <div key={f.id} className="card">
            <input
              value={f.title}
              placeholder="標題"
              onChange={(e) => set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
            />
            <textarea
              rows={3}
              value={f.content}
              placeholder="這段過去的內容"
              onChange={(e) => set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
            />
            <label>
              解鎖好感度（0–100）
              <input
                type="number"
                min={0}
                max={100}
                value={f.unlockAt}
                onChange={(e) =>
                  set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, unlockAt: Number(e.target.value) || 0 } : x)))
                }
              />
            </label>
            <button className="danger" onClick={() => set('fragments', form.fragments.filter((_, j) => j !== i))}>
              刪除這則
            </button>
          </div>
        ))}
        <button onClick={() => set('fragments', [...form.fragments, { id: uid(), title: '', content: '', unlockAt: 30 }])}>
          ＋ 新增回憶碎片
        </button>

        {initial && onDelete && (
          <button className="danger" onClick={onDelete}>刪除角色</button>
        )}
      </main>
    </div>
  )
}

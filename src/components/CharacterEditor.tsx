import { useEffect, useRef, useState } from 'react'
import { blankForm, CharForm } from '../characters'
import { generateCharacter } from '../llm'
import { compressImage, type ImageKind } from '../image'
import { fallbackArt } from '../look'
import { Character, Settings, uid } from '../types'
import Icon from './Icon'
import Avatar from './Avatar'

interface Props {
  initial: Character | null
  settings: Settings
  onSave: (c: Character) => void
  onCancel: () => void
  onDelete?: () => void
  onToast: (msg: string) => void
}

const DRAFT_KEY = 'chatsim2.draft'

function loadDraft(): CharForm | null {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
  } catch {
    return null
  }
}

const IMG_LABEL: Record<ImageKind, string> = { avatar: '頭像', portrait: '立繪', background: '聊天背景' }

export default function CharacterEditor({ initial, settings, onSave, onCancel, onDelete, onToast }: Props) {
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
  const [imgBusy, setImgBusy] = useState<ImageKind | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingKind = useRef<ImageKind>('portrait')

  // 新角色：自動儲存草稿（圖片太大存不下時就只存文字）
  useEffect(() => {
    if (initial) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {
      try {
        const { avatar: _a, portrait: _p, background: _b, ...text } = form
        void _a
        void _p
        void _b
        localStorage.setItem(DRAFT_KEY, JSON.stringify(text))
      } catch {
        /* ignore */
      }
    }
  }, [form, initial])

  const set = <K extends keyof CharForm>(k: K, v: CharForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const pickImage = (kind: ImageKind) => {
    pendingKind.current = kind
    fileRef.current?.click()
  }

  const onFile = async (file: File) => {
    const kind = pendingKind.current
    setImgBusy(kind)
    try {
      const url = await compressImage(file, kind)
      set(kind, url)
      // 只上傳立繪時，順便用立繪裁一張頭像
      if (kind === 'portrait' && !form.avatar) set('avatar', await compressImage(file, 'avatar'))
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setImgBusy(null)
    }
  }

  const submit = () => {
    if (!form.name.trim()) {
      onToast('請先幫角色取個名字')
      return
    }
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
      setForm((f) => ({
        ...f,
        name: d.name || f.name,
        userName: d.userName || f.userName,
        persona: d.persona || f.persona,
        greeting: d.greeting || f.greeting,
        innerVoice: true,
        fragments: (d.fragments ?? []).map((fr) => ({
          id: uid(),
          title: fr.title,
          content: fr.content,
          unlockAt: Number(fr.unlockAt) || 0,
        })),
      }))
      onToast('角色卡寫好了，看看要不要調整')
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const art = form.portrait || form.avatar
  const preview = { ...form, id: 'preview', createdAt: 0 } as Character

  return (
    <div className="editor">
      <header className="editor-head">
        <button className="icon-btn" onClick={onCancel} aria-label="返回">
          <Icon name="back" />
        </button>
        <h1>{initial ? `編輯 ${initial.name}` : '新角色'}</h1>
        <button className="btn primary small" onClick={submit}>
          儲存
        </button>
      </header>

      <div className="editor-body">
        <div className="editor-grid">
          <aside className="editor-visual">
            <div className="portrait-slot">
              <button
                className="art"
                style={{ backgroundImage: art ? `url(${art})` : fallbackArt(form.name || '新'), border: 'none', cursor: 'pointer', width: '100%' }}
                onClick={() => pickImage('portrait')}
                aria-label="上傳立繪"
              >
                {!art && (form.name || '新').slice(0, 1)}
              </button>
              <button
                className="avatar-slot"
                onClick={() => pickImage('avatar')}
                aria-label="上傳頭像"
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', borderRadius: '50%' }}
              >
                <Avatar c={preview} size={72} />
              </button>
            </div>
            <div className="img-actions">
              {(['portrait', 'avatar', 'background'] as ImageKind[]).map((k) => (
                <span key={k} className="img-chip">
                  <button className="btn small" onClick={() => pickImage(k)} disabled={imgBusy !== null}>
                    <Icon name="image" size={16} />
                    {imgBusy === k ? '處理中…' : form[k] ? `換${IMG_LABEL[k]}` : `上傳${IMG_LABEL[k]}`}
                  </button>
                  {form[k] && (
                    <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => set(k, undefined)} aria-label={`移除${IMG_LABEL[k]}`}>
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div
              className="bg-thumb"
              style={form.background ? { backgroundImage: `url(${form.background})`, borderStyle: 'solid' } : undefined}
            >
              {!form.background && '沒有背景時，聊天畫面會用立繪做柔光底'}
            </div>
            <p className="hint" style={{ textAlign: 'center' }}>
              圖片會自動縮小，跟著角色一起同步。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ''
              }}
            />
          </aside>

          <div className="editor-form">
            {!initial && (
              <div className="ai-box">
                <span className="ai-title">
                  <Icon name="spark" size={18} />
                  用一句話描述，交給 AI 寫完
                </span>
                <div className="row">
                  <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="嘴硬心軟的圖書館管理員" onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void aiFill()} />
                  <button className="btn primary" onClick={aiFill} disabled={busy || !idea.trim()}>
                    {busy ? '寫作中…' : '產生'}
                  </button>
                </div>
                <small className="faint">草稿會自動保存，離開再回來還在。</small>
              </div>
            )}

            <label className="field">
              <span>名字</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="小夢" />
            </label>
            <label className="field">
              <span>怎麼稱呼你</span>
              <input value={form.userName} onChange={(e) => set('userName', e.target.value)} placeholder="Andy" />
            </label>
            <label className="field">
              <span>個性與背景</span>
              <textarea rows={7} value={form.persona} onChange={(e) => set('persona', e.target.value)} placeholder="性格、說話口吻、經歷，以及和你是什麼關係" />
            </label>
            <label className="field">
              <span>第一句話</span>
              <textarea rows={3} className="voice" value={form.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="欸，你終於來了。" />
              <small>角色會照這句話的語氣說下去，寫得越像本人越好。</small>
            </label>
            <label className="switch">
              <span className="switch-text">
                顯示內心戲
                <small>每次回覆附上一句只有你看得到的心聲</small>
              </span>
              <input type="checkbox" checked={form.innerVoice} onChange={(e) => set('innerVoice', e.target.checked)} />
            </label>

            <h3>回憶碎片</h3>
            <p className="hint" style={{ marginTop: -12 }}>
              好感到了門檻才解鎖，解鎖後角色才會在對話中慢慢提起。
            </p>
            {form.fragments.map((f, i) => (
              <div key={f.id} className="frag-edit">
                <div className="row">
                  <input
                    value={f.title}
                    placeholder="標題"
                    className="voice"
                    onChange={(e) => set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <button className="icon-btn" onClick={() => set('fragments', form.fragments.filter((_, j) => j !== i))} aria-label="刪除這則回憶">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={f.content}
                  placeholder="這段過去發生了什麼"
                  onChange={(e) => set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
                />
                <label className="unlock">
                  <Icon name="drop" size={16} />
                  好感達到
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={f.unlockAt}
                    onChange={(e) =>
                      set('fragments', form.fragments.map((x, j) => (j === i ? { ...x, unlockAt: Number(e.target.value) || 0 } : x)))
                    }
                  />
                  時解鎖
                </label>
              </div>
            ))}
            <div>
              <button className="btn small" onClick={() => set('fragments', [...form.fragments, { id: uid(), title: '', content: '', unlockAt: 30 }])}>
                <Icon name="plus" size={16} />
                新增回憶碎片
              </button>
            </div>

            {initial && onDelete && (
              <div style={{ marginTop: 16, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <button className="btn danger small" onClick={onDelete}>
                  <Icon name="trash" size={16} />
                  刪除這個角色
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

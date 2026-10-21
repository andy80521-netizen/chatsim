import { useEffect, useRef } from 'react'
import Icon from './Icon'

// 關鍵時刻的全螢幕演出：關係升階、回憶碎片解鎖、成就
export type MomentData =
  | { kind: 'stage'; title: string; sub: string }
  | { kind: 'fragment'; title: string; sub: string }
  | { kind: 'achv'; title: string; sub: string }

const LABEL: Record<MomentData['kind'], string> = {
  stage: '關係更近了',
  fragment: '解鎖回憶碎片',
  achv: '獲得成就',
}

export default function Moment({ m, onDone }: { m: MomentData; onDone: () => void }) {
  // onDone 每次 render 都是新函式，用 ref 才不會讓計時器一直重設
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = setTimeout(() => done.current(), m.kind === 'achv' ? 2600 : 3400)
    return () => clearTimeout(t)
  }, [m])

  return (
    <div className={`moment moment-${m.kind}`} role="status" aria-live="polite" onClick={onDone}>
      <div className="moment-bloom" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="moment-body">
        <span className="moment-mark" aria-hidden="true">
          <Icon name={m.kind === 'stage' ? 'heart' : m.kind === 'fragment' ? 'memory' : 'trophy'} size={26} />
        </span>
        <p className="moment-label">{LABEL[m.kind]}</p>
        <div className="moment-text">
          <h2 className="moment-title">{m.title}</h2>
          <p className="moment-sub">{m.sub}</p>
        </div>
        <p className="moment-hint">點一下繼續</p>
      </div>
    </div>
  )
}

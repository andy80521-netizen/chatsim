import { useEffect, type ReactNode } from 'react'
import Icon from './Icon'

// 手機：底部抽屜；電腦：置中對話框
export default function Modal({
  title,
  onClose,
  children,
  dismissable = true,
}: {
  title?: string
  onClose: () => void
  children: ReactNode
  dismissable?: boolean
}) {
  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissable])

  return (
    <div className="overlay" onClick={dismissable ? onClose : undefined}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grip" aria-hidden="true" />
        {title ? (
          <div className="sheet-head">
            <h2>{title}</h2>
            {dismissable && (
              <button className="icon-btn" onClick={onClose} aria-label="關閉">
                <Icon name="close" />
              </button>
            )}
          </div>
        ) : (
          dismissable && (
            <button className="icon-btn sheet-close" onClick={onClose} aria-label="關閉">
              <Icon name="close" />
            </button>
          )
        )}
        {children}
      </div>
    </div>
  )
}

import { type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useArkDecoratedText } from '../../hooks/useArkDecoratedText'

type WorkspaceTabButtonProps = {
  label: string
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  closable: boolean
  closeLabel: string
  detachStatus?: 'inline' | 'detached'
  onToggleDetach?: () => void
  detachLabel?: string
  dockLabel?: string
}

export function WorkspaceTabButton({
  label,
  isActive,
  onActivate,
  onClose,
  closable,
  closeLabel,
  detachStatus,
  onToggleDetach,
  detachLabel,
  dockLabel,
}: WorkspaceTabButtonProps) {
  const decoratedLabel = useArkDecoratedText(label)
  const toggleLabel = detachStatus === 'detached' ? dockLabel ?? detachLabel : detachLabel

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate()
    }
  }

  return (
    <div
      className={`workspace-tab${isActive ? ' is-active' : ''}`}
      role="tab"
      aria-selected={isActive}
      title={decoratedLabel}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      <span className="workspace-tab__label">{decoratedLabel}</span>
      {onToggleDetach && toggleLabel ? (
        <button
          type="button"
          className={`detach${detachStatus === 'detached' ? ' is-active' : ''}`}
          aria-label={toggleLabel}
          onClick={event => {
            event.stopPropagation()
            onToggleDetach()
          }}
        >
          {detachStatus === 'detached' ? '⬅' : '⤢'}
        </button>
      ) : null}
      {closable ? (
        <button
          type="button"
          className="close"
          aria-label={closeLabel}
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

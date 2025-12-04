import { useArkDecoratedText } from '../../hooks/useArkDecoratedText'

type DetachedTabPlaceholderProps = {
  label: string
  message: string
  actionLabel: string
  onDock: () => void
}

export function DetachedTabPlaceholder({ label, message, actionLabel, onDock }: DetachedTabPlaceholderProps) {
  const decoratedLabel = useArkDecoratedText(label)
  return (
    <div className="detached-tab-placeholder">
      <p>{message}</p>
      <p className="detached-tab-placeholder__label">{decoratedLabel}</p>
      <button type="button" onClick={onDock}>
        {actionLabel}
      </button>
    </div>
  )
}

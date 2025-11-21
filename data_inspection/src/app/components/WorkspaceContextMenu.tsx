type WorkspaceContextMenuProps = {
  position: { x: number; y: number }
  openLabel: string
  openDetachedLabel: string
  onOpen: () => void
  onOpenDetached: () => void
  extraActionLabel?: string
  extraActionDisabled?: boolean
  onExtraAction?: () => void
}

export function WorkspaceContextMenu({
  position,
  openLabel,
  openDetachedLabel,
  onOpen,
  onOpenDetached,
  extraActionLabel,
  extraActionDisabled,
  onExtraAction,
}: WorkspaceContextMenuProps) {
  return (
    <div
      className="workspace-context-menu"
      style={{ top: `${position.y}px`, left: `${position.x}px` }}
      role="menu"
    >
      <button type="button" role="menuitem" onClick={onOpen}>
        {openLabel}
      </button>
      <button type="button" role="menuitem" onClick={onOpenDetached}>
        {openDetachedLabel}
      </button>
      {extraActionLabel && onExtraAction ? (
        <button
          type="button"
          role="menuitem"
          disabled={extraActionDisabled}
          onClick={onExtraAction}
        >
          {extraActionLabel}
        </button>
      ) : null}
    </div>
  )
}

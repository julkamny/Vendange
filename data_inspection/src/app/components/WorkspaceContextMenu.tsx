export type MenuAction = { label: string; disabled?: boolean; onSelect: () => void }

type WorkspaceContextMenuProps = {
  position: { x: number; y: number }
  openLabel: string
  openDetachedLabel: string
  onOpen: () => void
  onOpenDetached: () => void
  extraActions?: MenuAction[]
}

export function WorkspaceContextMenu({
  position,
  openLabel,
  openDetachedLabel,
  onOpen,
  onOpenDetached,
  extraActions,
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
      {extraActions?.map(action => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

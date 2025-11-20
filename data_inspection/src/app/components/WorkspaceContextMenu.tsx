type WorkspaceContextMenuProps = {
  position: { x: number; y: number }
  openLabel: string
  openDetachedLabel: string
  onOpen: () => void
  onOpenDetached: () => void
}

export function WorkspaceContextMenu({
  position,
  openLabel,
  openDetachedLabel,
  onOpen,
  onOpenDetached,
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
    </div>
  )
}

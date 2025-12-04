import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

type AddTabMenuProps = {
  onAddWorkspace: () => void
  onAddAgent: () => void
  onAddSparql: () => void
  label: string
  workspaceLabel: string
  agentLabel: string
  sparqlLabel: string
}

export function AddTabMenu({
  onAddWorkspace,
  onAddAgent,
  onAddSparql,
  label,
  workspaceLabel,
  agentLabel,
  sparqlLabel,
}: AddTabMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuItems = useMemo(
    () => [
      { label: workspaceLabel, action: onAddWorkspace },
      { label: agentLabel, action: onAddAgent },
      { label: sparqlLabel, action: onAddSparql },
    ],
    [workspaceLabel, onAddWorkspace, agentLabel, onAddAgent, sparqlLabel, onAddSparql],
  )

  const closeMenu = useCallback(() => setOpen(false), [])

  const focusItem = useCallback((index: number) => {
    const el = itemRefs.current[index]
    if (el) el.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) {
        closeMenu()
      }
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        toggleRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [closeMenu, open])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      focusItem(0)
    })
  }, [focusItem, open])

  const handleToggleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    }
  }

  const handleItemKeyDown = (index: number, total: number) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const lastIndex = total - 1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(index === lastIndex ? 0 : index + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(index === 0 ? lastIndex : index - 1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusItem(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusItem(lastIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      toggleRef.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      closeMenu()
    }
  }

  const handleSelect = (action: () => void) => {
    closeMenu()
    action()
  }

  return (
    <div className="workspace-tab add menu" ref={wrapperRef}>
      <button
        type="button"
        className="workspace-tab add add-toggle workspace-add-toggle"
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={handleToggleKeyDown}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="workspace-add-menu"
        ref={toggleRef}
      >
        <span aria-hidden className="workspace-add-toggle__icon">+</span>
      </button>
      {open ? (
        <div className="workspace-add-menu" role="menu" id="workspace-add-menu">
          {menuItems.map((item, index) => (
            <button
              key={item.label}
              type="button"
              className="workspace-add-menu__item"
              role="menuitem"
              onClick={() => handleSelect(item.action)}
              onKeyDown={handleItemKeyDown(index, menuItems.length)}
              ref={el => {
                itemRefs.current[index] = el
              }}
            >
              <span className="workspace-add-menu__label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShortcuts } from './ShortcutContext'
import { shortcutMatchesEvent } from '../core/shortcuts'

type DetachedWindowRecord = {
  id: string
  title: string
  windowRef: Window
  container: HTMLDivElement
  onClose?: () => void
  handleBeforeUnload: () => void
}

type OpenWindowOptions = {
  title: string
  classNames?: string[]
  features?: string
  onClose?: () => void
}

type DetachedWindowContextValue = {
  openWindow: (options: OpenWindowOptions) => string | null
  closeWindow: (id: string) => void
  getContainer: (id: string) => HTMLDivElement | null
  isOpen: (id: string) => boolean
  arrangeWindows: (strategy: 'tile' | 'cascade' | 'stack') => void
}

const DetachedWindowContext = createContext<DetachedWindowContextValue | null>(null)

export function DetachedWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<DetachedWindowRecord[]>([])
  const sequenceRef = useRef(0)
  const { bindings } = useShortcuts()

  const getContainer = useCallback(
    (id: string) => windows.find(win => win.id === id)?.container ?? null,
    [windows],
  )

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const target = prev.find(win => win.id === id)
      if (!target) return prev
      target.windowRef.removeEventListener('beforeunload', target.handleBeforeUnload)
      if (!target.windowRef.closed) {
        target.windowRef.close()
      }
      target.onClose?.()
      return prev.filter(win => win.id !== id)
    })
  }, [])

  const arrangeWindows = useCallback(
    (strategy: 'tile' | 'cascade' | 'stack') => {
      // Include the main window in the arrangement
      const allWindows = [
        { id: 'main', windowRef: window },
        ...windows,
      ]

      const screenWidth = window.screen.availWidth
      const screenHeight = window.screen.availHeight
      const count = allWindows.length

      if (count === 0) return

      if (strategy === 'tile') {
        const cols = Math.ceil(Math.sqrt(count))
        const rows = Math.ceil(count / cols)
        const width = Math.floor(screenWidth / cols)
        const height = Math.floor(screenHeight / rows)

        allWindows.forEach((win, index) => {
          const col = index % cols
          const row = Math.floor(index / cols)
          try {
            if (win.windowRef.closed) return
            win.windowRef.resizeTo(width, height)
            win.windowRef.moveTo(col * width, row * height)
            win.windowRef.focus()
          } catch (e) {
            console.warn('Failed to move/resize window:', e)
          }
        })
      } else if (strategy === 'cascade') {
        const width = Math.floor(screenWidth * 0.6)
        const height = Math.floor(screenHeight * 0.6)
        const offset = 30

        allWindows.forEach((win, index) => {
          try {
            if (win.windowRef.closed) return
            win.windowRef.resizeTo(width, height)
            win.windowRef.moveTo(index * offset, index * offset)
            win.windowRef.focus()
          } catch (e) {
            console.warn('Failed to move/resize window:', e)
          }
        })
      }
    },
    [windows]
  )

  const handleShortcutEvent = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const action = shortcutMatchesEvent(bindings.arrangeTile, event)
      ? 'tile'
      : shortcutMatchesEvent(bindings.arrangeCascade, event)
        ? 'cascade'
        : null
    if (!action) return
    event.preventDefault()
    arrangeWindows(action)
  }, [arrangeWindows, bindings.arrangeCascade, bindings.arrangeTile])

  useEffect(() => {
    window.addEventListener('keydown', handleShortcutEvent)
    return () => window.removeEventListener('keydown', handleShortcutEvent)
  }, [handleShortcutEvent])

  const openWindow = useCallback(
    (options: OpenWindowOptions): string | null => {
      if (typeof window === 'undefined') return null
      const features = options.features ?? 'width=1280,height=800'
      const child = window.open('', '_blank', features)
      if (!child) return null
      try {
        child.opener = null
      } catch {
        // ignore if browser disallows
      }
      const id = `detached-${++sequenceRef.current}`
      child.document.write('<!DOCTYPE html><html><head><title></title></head><body></body></html>')
      child.document.close()
      hydrateChildDocument(document, child.document, options.classNames)
      child.document.title = options.title
      const container = child.document.createElement('div')
      container.classList.add('detached-window-root')
      if (options.classNames?.length) {
        container.classList.add(...options.classNames)
      }
      child.document.body.appendChild(container)

      // Inject shortcut listener into child window
      const childShortcutHandler = (event: KeyboardEvent) => handleShortcutEvent(event)
      child.addEventListener('keydown', childShortcutHandler)

      const handleBeforeUnload = () => {
        setWindows(prev => {
          const target = prev.find(win => win.id === id)
          if (!target) return prev
          target.onClose?.()
          return prev.filter(win => win.id !== id)
        })
        child.removeEventListener('keydown', childShortcutHandler)
      }

      child.addEventListener('beforeunload', handleBeforeUnload)
      setWindows(prev => [
        ...prev,
        {
          id,
          title: options.title,
          windowRef: child,
          container,
          onClose: options.onClose,
          handleBeforeUnload,
        },
      ])
      return id
    },
    [handleShortcutEvent],
  )

  const value = useMemo(
    () => ({
      openWindow,
      closeWindow,
      getContainer,
      isOpen: (id: string) => windows.some(win => win.id === id),
      arrangeWindows,
    }),
    [closeWindow, getContainer, openWindow, windows, arrangeWindows],
  )

  return <DetachedWindowContext.Provider value={value}>{children}</DetachedWindowContext.Provider>
}

export function useDetachedWindows() {
  const ctx = useContext(DetachedWindowContext)
  if (!ctx) {
    console.error('useDetachedWindows called outside provider!')
    throw new Error('useDetachedWindows must be used within DetachedWindowProvider')
  }
  return ctx
}

function hydrateChildDocument(source: Document, target: Document, classNames?: string[]) {
  copyStyles(source, target)
  const theme = source.documentElement.getAttribute('data-theme')
  if (theme) {
    target.documentElement.setAttribute('data-theme', theme)
  }
  // Ensure CSS variables that depend on the main shell are available in the detached document.
  const shell = source.querySelector<HTMLElement>('.app-shell')
  const shellStyles = shell ? getComputedStyle(shell) : getComputedStyle(source.documentElement)
  const stickyOffset =
    shellStyles.getPropertyValue('--app-sticky-offset') ||
    shellStyles.getPropertyValue('--app-sticky-offset-collapsed') ||
    '0px'
  target.documentElement.style.setProperty('--app-sticky-offset', stickyOffset.trim())

  target.body.className = source.body.className
  if (classNames?.length) {
    target.body.classList.add(...classNames)
  }
}

function copyStyles(source: Document, target: Document) {
  for (const styleSheet of Array.from(source.styleSheets)) {
    try {
      if (!styleSheet.cssRules?.length) continue
      const rules = Array.from(styleSheet.cssRules).map(rule => rule.cssText).join('\n')
      const style = target.createElement('style')
      style.textContent = rules
      target.head.appendChild(style)
    } catch {
      if (!styleSheet.href) continue
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = styleSheet.href
      target.head.appendChild(link)
    }
  }
}

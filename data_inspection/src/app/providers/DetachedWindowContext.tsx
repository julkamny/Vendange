import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

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
}

const DetachedWindowContext = createContext<DetachedWindowContextValue | null>(null)

export function DetachedWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<DetachedWindowRecord[]>([])
  const sequenceRef = useRef(0)

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

      const handleBeforeUnload = () => {
        setWindows(prev => {
          const target = prev.find(win => win.id === id)
          if (!target) return prev
          target.onClose?.()
          return prev.filter(win => win.id !== id)
        })
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
    [],
  )

  const value = useMemo(
    () => ({
      openWindow,
      closeWindow,
      getContainer,
      isOpen: (id: string) => windows.some(win => win.id === id),
    }),
    [closeWindow, getContainer, openWindow, windows],
  )

  return <DetachedWindowContext.Provider value={value}>{children}</DetachedWindowContext.Provider>
}

export function useDetachedWindows() {
  const ctx = useContext(DetachedWindowContext)
  if (!ctx) throw new Error('useDetachedWindows must be used within DetachedWindowProvider')
  return ctx
}

function hydrateChildDocument(source: Document, target: Document, classNames?: string[]) {
  copyStyles(source, target)
  const theme = source.documentElement.getAttribute('data-theme')
  if (theme) {
    target.documentElement.setAttribute('data-theme', theme)
  }
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
    } catch (error) {
      if (!styleSheet.href) continue
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      link.href = styleSheet.href
      target.head.appendChild(link)
    }
  }
}

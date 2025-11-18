import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  SHORTCUTS,
  createDefaultShortcutBindings,
  loadShortcutBindings,
  persistShortcutBindings,
  type ShortcutBindings,
  type ShortcutAction,
} from '../core/shortcuts'
import { postBroadcastEvent, subscribeToBroadcast, getBroadcastClientId } from '../lib/broadcast'

type ShortcutContextValue = {
  bindings: ShortcutBindings
  updateBinding: (action: ShortcutAction, binding: string) => void
  resetBindings: () => void
  activeWindowId: string
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null)

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => loadShortcutBindings())
  const [activeWindowId, setActiveWindowId] = useState(() => getBroadcastClientId())
  const clientId = getBroadcastClientId()

  useEffect(() => {
    persistShortcutBindings(bindings)
  }, [bindings])

  const updateBinding = useCallback((action: ShortcutAction, binding: string) => {
    setBindings(prev => ({ ...prev, [action]: binding }))
  }, [])

  const resetBindings = useCallback(() => {
    setBindings(createDefaultShortcutBindings())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const sendFocus = () => {
      setActiveWindowId(clientId)
      postBroadcastEvent({ type: 'shortcut-focus', windowId: clientId, active: true })
    }
    const sendBlur = () => {
      postBroadcastEvent({ type: 'shortcut-focus', windowId: clientId, active: false })
    }
    window.addEventListener('focus', sendFocus)
    window.addEventListener('blur', sendBlur)
    sendFocus()
    return () => {
      window.removeEventListener('focus', sendFocus)
      window.removeEventListener('blur', sendBlur)
    }
  }, [clientId])

  useEffect(() => {
    return subscribeToBroadcast(event => {
      if (event.sourceId === clientId) return
      if (event.type === 'shortcut-focus' && event.active) {
        setActiveWindowId(event.windowId)
      }
    })
  }, [clientId])

  const value = useMemo(
    () => ({ bindings, updateBinding, resetBindings, activeWindowId }),
    [bindings, updateBinding, resetBindings, activeWindowId],
  )

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>
}

export function useShortcuts() {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('useShortcuts must be used within ShortcutProvider')
  return { ...ctx, shortcuts: SHORTCUTS }
}

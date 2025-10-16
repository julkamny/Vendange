import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  SHORTCUTS,
  createDefaultShortcutBindings,
  loadShortcutBindings,
  persistShortcutBindings,
  type ShortcutBindings,
  type ShortcutAction,
} from '../core/shortcuts'

type ShortcutContextValue = {
  bindings: ShortcutBindings
  updateBinding: (action: ShortcutAction, binding: string) => void
  resetBindings: () => void
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null)

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => loadShortcutBindings())

  useEffect(() => {
    persistShortcutBindings(bindings)
  }, [bindings])

  const updateBinding = useCallback((action: ShortcutAction, binding: string) => {
    setBindings(prev => ({ ...prev, [action]: binding }))
  }, [])

  const resetBindings = useCallback(() => {
    setBindings(createDefaultShortcutBindings())
  }, [])

  const value = useMemo(() => ({ bindings, updateBinding, resetBindings }), [bindings, updateBinding, resetBindings])

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>
}

export function useShortcuts() {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('useShortcuts must be used within ShortcutProvider')
  return { ...ctx, shortcuts: SHORTCUTS }
}


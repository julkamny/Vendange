/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import type { ThemeMode } from '../types'
import { applyTheme, detectPreferredTheme, readStoredTheme } from '../core/theme'
import { postBroadcastEvent, subscribeToBroadcast, getBroadcastClientId } from '../lib/broadcast'

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme() ?? detectPreferredTheme())
  const suppressBroadcastRef = useRef(false)
  const clientId = getBroadcastClientId()

  useEffect(() => {
    applyTheme(mode)
    if (suppressBroadcastRef.current) {
      suppressBroadcastRef.current = false
      return
    }
    postBroadcastEvent({ type: 'theme-change', theme: mode })
  }, [mode])

  useEffect(() => {
    return subscribeToBroadcast(event => {
      if (event.sourceId === clientId) return
      if (event.type === 'theme-change') {
        suppressBroadcastRef.current = true
        setMode(event.theme)
      }
    })
  }, [clientId, setMode])

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(prev => (prev === 'dark' ? 'light' : 'dark')),
    }),
    [mode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

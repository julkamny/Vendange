import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react'
import type { ThemeMode } from '../types'
import { applyTheme, detectPreferredTheme, readStoredTheme } from '../core/theme'

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme() ?? detectPreferredTheme())

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

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


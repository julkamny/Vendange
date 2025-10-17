import { THEME_STORAGE_KEY } from './constants'
import type { ThemeMode } from '../types'

const DARK: ThemeMode = 'dark'
const LIGHT: ThemeMode = 'light'

export function readStoredTheme(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
    if (stored === LIGHT || stored === DARK) return stored
  } catch {
    // ignore quota errors
  }
  return null
}

export function detectPreferredTheme(): ThemeMode {
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return LIGHT
  return DARK
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // ignore storage errors
  }
}


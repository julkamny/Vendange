import { SHORTCUT_STORAGE_KEY } from './constants'
import type { ShortcutAction, ShortcutConfig } from '../types'

export const SHORTCUTS: ShortcutConfig[] = [
  {
    action: 'focusUp',
    labelKey: 'shortcuts.focusUp.label',
    descriptionKey: 'shortcuts.focusUp.description',
    defaultBinding: 'Ctrl+ArrowUp',
  },
  {
    action: 'focusDown',
    labelKey: 'shortcuts.focusDown.label',
    descriptionKey: 'shortcuts.focusDown.description',
    defaultBinding: 'Ctrl+ArrowDown',
  },
  {
    action: 'listUp',
    labelKey: 'shortcuts.listUp.label',
    descriptionKey: 'shortcuts.listUp.description',
    defaultBinding: 'ArrowUp',
  },
  {
    action: 'listDown',
    labelKey: 'shortcuts.listDown.label',
    descriptionKey: 'shortcuts.listDown.description',
    defaultBinding: 'ArrowDown',
  },
]

export type ShortcutBindings = Record<ShortcutAction, string>

export function createDefaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(SHORTCUTS.map(sc => [sc.action, sc.defaultBinding])) as ShortcutBindings
}

export function loadShortcutBindings(): ShortcutBindings {
  const bindings = createDefaultShortcutBindings()
  try {
    const stored = localStorage.getItem(SHORTCUT_STORAGE_KEY)
    if (!stored) return bindings
    const parsed = JSON.parse(stored) as Partial<Record<ShortcutAction, string>>
    for (const shortcut of SHORTCUTS) {
      const value = parsed[shortcut.action]
      if (typeof value === 'string' && value.trim()) {
        bindings[shortcut.action] = value
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return bindings
}

export function persistShortcutBindings(bindings: ShortcutBindings) {
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // ignore storage errors
  }
}

export type { ShortcutAction } from '../types'
export { SHORTCUTS as SHORTCUT_DEFINITIONS }

export type NormalizedShortcut = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export function normalizeShortcutString(binding: string): NormalizedShortcut | null {
  const parts = binding
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) return null
  const result: NormalizedShortcut = { key: '', ctrl: false, alt: false, shift: false, meta: false }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') {
      result.ctrl = true
    } else if (part === 'alt' || part === 'option') {
      result.alt = true
    } else if (part === 'shift') {
      result.shift = true
    } else if (part === 'meta' || part === 'cmd' || part === 'command') {
      result.meta = true
    } else {
      result.key = part
    }
  }
  return result.key ? result : null
}

export function shortcutMatchesEvent(binding: string, event: KeyboardEvent): boolean {
  const normalized = normalizeShortcutString(binding)
  if (!normalized) return false
  if (normalized.ctrl !== event.ctrlKey) return false
  if (normalized.alt !== event.altKey) return false
  if (normalized.shift !== event.shiftKey) return false
  if (normalized.meta !== event.metaKey) return false
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  return normalized.key === eventKey
}

export function formatShortcutFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.metaKey) parts.push('Meta')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

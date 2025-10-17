import { useEffect, useState } from 'react'
import { resolveArkLabel } from '../lib/intermarc'

const ARK_REGEX = /ark:\/\S+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function useArkDecoratedText(text: string): string {
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    let cancelled = false
    if (!text || !text.includes('ark:/')) {
      setDisplay(text)
      return
    }
    const matches = Array.from(new Set(text.match(ARK_REGEX) ?? []))
    if (!matches.length) {
      setDisplay(text)
      return
    }
    ;(async () => {
      const replacements = await Promise.all(
        matches.map(async ark => ({
          ark,
          label: await resolveArkLabel(ark),
        })),
      )
      if (cancelled) return
      let updated = text
      let changed = false
      for (const { ark, label } of replacements) {
        if (!label || label === ark) continue
        if (!updated.includes(ark)) continue
        updated = updated.replace(new RegExp(escapeRegExp(ark), 'g'), label)
        changed = true
      }
      setDisplay(changed ? updated : text)
    })().catch(() => {
      if (!cancelled) setDisplay(text)
    })
    return () => {
      cancelled = true
    }
  }, [text])

  return display
}

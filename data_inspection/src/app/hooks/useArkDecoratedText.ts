import { useMemo } from 'react'

const ARK_REGEX = /ark:\/\S+/g

export function useArkDecoratedText(text: string, arkLabels?: Record<string, string>): string {
  return useMemo(() => {
    if (!text || !text.includes('ark:/') || !arkLabels) return text
    const matches = Array.from(new Set(text.match(ARK_REGEX) ?? []))
    if (!matches.length) return text
    let updated = text
    let changed = false
    matches.forEach(ark => {
      const label = arkLabels[ark] ?? arkLabels[ark.toLowerCase()]
      if (!label || label === ark || !updated.includes(ark)) return
      updated = updated.split(ark).join(label)
      changed = true
    })
    return changed ? updated : text
  }, [arkLabels, text])
}

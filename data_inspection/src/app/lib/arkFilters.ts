import type { SparqlQueryResult } from '../workspace/types'
import { deriveInternalIdFromArk } from './ark'

// Shared ARK utilities used by SPARQL extraction and list filtering
export const ARK_REGEX = /ark:\/\S+/giu

export function normalizeArk(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const matcher = new RegExp(ARK_REGEX.source, ARK_REGEX.flags)
  const match = trimmed.match(matcher)
  const ark = match?.[0] ?? trimmed
  return ark.toLowerCase()
}

export function normalizeArkList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values) return []
  const set = new Set<string>()
  values.forEach(value => {
    const normalized = normalizeArk(value)
    if (normalized) set.add(normalized)
  })
  return Array.from(set)
}

export function buildArkSet(values: string[] | null | undefined): Set<string> {
  return new Set(normalizeArkList(values ?? []))
}

export function buildArkAndIdSets(values: string[] | null | undefined): {
  arks: Set<string>
  ids: Set<string>
  key: string
} {
  const arks = buildArkSet(values)
  const ids = new Set<string>()
  ;(values ?? []).forEach(value => {
    const maybeId = deriveInternalIdFromArk(value)
    if (maybeId) ids.add(String(maybeId))
    if (typeof value === 'string') {
      const match = value.match(/entity\/([^/#?]+)/i)
      if (match?.[1]) ids.add(match[1])
    }
  })
  return { arks, ids, key: [...arks, ...ids].sort().join('|') }
}

export function extractArksFromResult(result: SparqlQueryResult, columns: string[]): string[] {
  const set = new Set<string>()
  const matcher = new RegExp(ARK_REGEX.source, ARK_REGEX.flags)
  for (const row of result.rows) {
    for (const column of columns) {
      const value = (row as Record<string, unknown>)[column]
      const normalized = normalizeArk(value)
      if (normalized) set.add(normalized)
      if (typeof value === 'string') {
        const matches = value.match(matcher)
        if (matches) {
          matches.forEach(ark => {
            const n = normalizeArk(ark)
            if (n) set.add(n)
          })
        }
      }
    }
  }
  return Array.from(set)
}

export function matchArksInText(value: string): string[] {
  const matcher = new RegExp(ARK_REGEX.source, ARK_REGEX.flags)
  return Array.from(value.matchAll(matcher)).map(match => match[0])
}

import { useCallback, useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { extractAgentNames } from '../core/agents'

type RecordLookup = {
  getById: (id?: string | null) => RecordRow | undefined
  getByArk: (ark?: string | null) => RecordRow | undefined
  getAgentNames: (id?: string | null, ark?: string | null) => string[]
}

export function useRecordLookup(): RecordLookup {
  const { original, curated } = useAppData()

  const index = useMemo(() => {
    const byId = new Map<string, RecordRow>()
    const byArk = new Map<string, RecordRow>()
    const ingest = (record: RecordRow) => {
      if (!byId.has(record.id)) byId.set(record.id, record)
      if (record.ark) byArk.set(record.ark.toLowerCase(), record)
    }
    curated?.records.forEach(ingest)
    original?.records.forEach(ingest)
    return { byId, byArk }
  }, [original?.records, curated?.records])

  const agentCache = useMemo(() => new Map<string, string[]>(), [index])

  const getById = useCallback(
    (id?: string | null) => {
      if (!id) return undefined
      return index.byId.get(id)
    },
    [index],
  )

  const getByArk = useCallback(
    (ark?: string | null) => {
      if (!ark) return undefined
      return index.byArk.get(ark.toLowerCase())
    },
    [index],
  )

  const getAgentNames = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record = (id && index.byId.get(id)) || (ark ? index.byArk.get(ark.toLowerCase()) : undefined)
      if (!record) return []
      if (agentCache.has(record.id)) return agentCache.get(record.id)!
      const names = extractAgentNames(record, {
        lookupRecordByArk: value => index.byArk.get(value.toLowerCase()),
      })
      agentCache.set(record.id, names)
      return names
    },
    [agentCache, index],
  )

  return { getById, getByArk, getAgentNames }
}

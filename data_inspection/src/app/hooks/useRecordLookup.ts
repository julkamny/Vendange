import { useCallback, useMemo } from 'react'
import { useEffect, useRef } from 'react'
import { useAppData } from '../providers/AppDataContext'
import type { RecordRow } from '../types'
import { extractAgentNames } from '../core/agents'
import { countGeneralRelationships } from '../core/generalRelationships'
import { extractMediaKinds, type MediaKind } from '../core/media'

type RecordLookup = {
  getById: (id?: string | null) => RecordRow | undefined
  getByArk: (ark?: string | null) => RecordRow | undefined
  getAgentNames: (id?: string | null, ark?: string | null) => string[]
  getGeneralRelationshipCount: (id?: string | null, ark?: string | null) => number
  getMediaKinds: (id?: string | null, ark?: string | null) => MediaKind[]
}

export function useRecordLookup(): RecordLookup {
  const { curated } = useAppData()
  const records = useMemo(() => curated?.records ?? [], [curated])
  const agentCache = useRef(new Map<string, string[]>())
  const relationshipCache = useRef(new Map<string, number>())
  const mediaCache = useRef(new Map<string, MediaKind[]>())

  const index = useMemo(() => {
    const byId = new Map<string, RecordRow>()
    const byArk = new Map<string, RecordRow>()
    const ingest = (record: RecordRow) => {
      if (!byId.has(record.id)) byId.set(record.id, record)
      if (record.ark) byArk.set(record.ark.toLowerCase(), record)
    }
    records.forEach(ingest)
    return { byId, byArk }
  }, [records])

  useEffect(() => {
    agentCache.current.clear()
    relationshipCache.current.clear()
    mediaCache.current.clear()
  }, [records])

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
      const record =
        (id && index.byId.get(id)) ||
        (typeof ark === 'string' ? index.byArk.get(ark.toLowerCase()) : undefined)
      if (!record) return []
      if (agentCache.current.has(record.id)) return agentCache.current.get(record.id)!
      const names = extractAgentNames(record, {
        lookupRecordByArk: value =>
          typeof value === 'string' ? index.byArk.get(value.toLowerCase()) : undefined,
      })
      agentCache.current.set(record.id, names)
      return names
    },
    [index],
  )

  const getGeneralRelationshipCount = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record =
        (id && index.byId.get(id)) ||
        (typeof ark === 'string' ? index.byArk.get(ark.toLowerCase()) : undefined)
      if (!record) return 0
      if (relationshipCache.current.has(record.id)) return relationshipCache.current.get(record.id)!
      const count = countGeneralRelationships(record)
      relationshipCache.current.set(record.id, count)
      return count
    },
    [index],
  )

  const getMediaKinds = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record =
        (id && index.byId.get(id)) ||
        (typeof ark === 'string' ? index.byArk.get(ark.toLowerCase()) : undefined)
      if (!record) return []
      if (mediaCache.current.has(record.id)) return mediaCache.current.get(record.id)!
      const kinds = extractMediaKinds(record, {
        lookupRecordByArk: value =>
          typeof value === 'string' ? index.byArk.get(value.toLowerCase()) : undefined,
      })
      mediaCache.current.set(record.id, kinds)
      return kinds
    },
    [index],
  )

  return { getById, getByArk, getAgentNames, getGeneralRelationshipCount, getMediaKinds }
}

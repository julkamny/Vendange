import { useCallback, useMemo, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppData } from '../providers/AppDataContext'
import { useWorkspaceWorks } from './useWorkspaceQueries'
import { mapWorkClusters } from '../lib/mapWorkClusters'
import { buildRecordRowFromPayload } from '../lib/recordPayload'
import { stubExpressionRecord, stubManifestationRecord, stubWorkRecord } from '../workspace/recordStubs'
import type { RecordRow, WorkRecordPayload } from '../types'
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
  const { datasetId } = useAppData()
  const queryClient = useQueryClient()
  const { data: workspaceWorks } = useWorkspaceWorks(datasetId)

  const stubbedRecords = useMemo<RecordRow[]>(() => {
    if (!workspaceWorks?.clusters && !workspaceWorks?.unclustered_works) return []
    const mappedClusters = mapWorkClusters(workspaceWorks?.clusters ?? [])
    const acc: RecordRow[] = []

    mappedClusters.forEach(cluster => {
      acc.push(stubWorkRecord(cluster.anchorId, cluster.anchorArk, cluster.anchorTitle ?? null, cluster.anchorTitleSegments))
      cluster.items.forEach(item =>
        acc.push(stubWorkRecord(item.id ?? item.ark ?? '', item.ark, item.title ?? null, item.titleSegments)),
      )
      cluster.expressionGroups.forEach(group => {
        const exprRow = stubExpressionRecord(group.anchor, cluster.anchorArk)
        acc.push(exprRow)
        group.anchor.manifestations.forEach(man => acc.push(stubManifestationRecord(man, group.anchor.ark)))
        group.clustered.forEach(expr => {
          acc.push(stubExpressionRecord(expr, cluster.anchorArk))
          expr.manifestations.forEach(man => acc.push(stubManifestationRecord(man, expr.ark ?? group.anchor.ark)))
        })
      })
      cluster.independentExpressions.forEach(expr => {
        acc.push(stubExpressionRecord(expr, cluster.anchorArk))
        expr.manifestations.forEach(man => acc.push(stubManifestationRecord(man, expr.ark ?? cluster.anchorArk)))
      })
    })

    ;(workspaceWorks?.unclustered_works ?? []).forEach(work => {
      acc.push(stubWorkRecord(work.id, work.ark ?? undefined, work.title ?? null, work.title_segments ?? undefined))
    })

    return acc
  }, [workspaceWorks?.clusters, workspaceWorks?.unclustered_works])

  const cachedRecords = useMemo<RecordRow[]>(() => {
    const queries = queryClient.getQueriesData({ queryKey: ['workspace', 'record', datasetId] })
    return queries.map(([, payload]) => (payload ? buildRecordRowFromPayload(payload as unknown as WorkRecordPayload) : null)).filter((rec): rec is RecordRow => Boolean(rec))
  }, [datasetId, queryClient])

  const records = useMemo<RecordRow[]>(() => {
    const byId = new Map<string, RecordRow>()
    const add = (rec: RecordRow) => {
      if (!rec.id) return
      byId.set(rec.id, rec)
    }
    stubbedRecords.forEach(add)
    cachedRecords.forEach(add)
    return Array.from(byId.values())
  }, [cachedRecords, stubbedRecords])
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

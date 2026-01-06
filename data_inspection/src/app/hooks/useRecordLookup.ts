import { useCallback, useMemo, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppData } from '../providers/AppDataContext'
import { useWorkspaceWorks } from './useWorkspaceQueries'
import { mapWorkClusters } from '../lib/mapWorkClusters'
import { buildRecordRowFromPayload } from '../lib/recordPayload'
import { stubExpressionRecord, stubManifestationRecord, stubWorkRecord } from '../workspace/recordStubs'
import type { Cluster, RecordRow, WorkClusterDto, WorkRecordPayload } from '../types'
import { mapWorkCluster } from '../lib/mapWorkClusters'

type RecordLookup = {
  getById: (id?: string | null) => RecordRow | undefined
  getByArk: (ark?: string | null) => RecordRow | undefined
}

export function useRecordLookup(): RecordLookup {
  const { datasetId } = useAppData()
  const queryClient = useQueryClient()
  const { data: workspaceWorks } = useWorkspaceWorks(datasetId)
  const [cacheVersion, setCacheVersion] = useState(0)

  /** Refresh cache snapshots when react-query data changes (e.g. work clusters/records). */
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      setCacheVersion(version => version + 1)
    })
    return unsubscribe
  }, [queryClient])

  const cachedClusters = useMemo<Cluster[]>(() => {
    void cacheVersion
    if (!datasetId) return []
    const queries = queryClient.getQueriesData({ queryKey: ['workspace', 'work', datasetId] })
    return queries
      .map(([, payload]) => (payload ? mapWorkCluster(payload as WorkClusterDto) : null))
      .filter((cluster): cluster is Cluster => Boolean(cluster))
  }, [datasetId, queryClient, cacheVersion])

  const stubbedRecords = useMemo<RecordRow[]>(() => {
    if (!workspaceWorks?.clusters && !workspaceWorks?.unclustered_works && !cachedClusters.length) return []
    const mappedClusters = mapWorkClusters(workspaceWorks?.clusters ?? [])
    const acc: RecordRow[] = []

    const addClusterRecords = (cluster: Cluster) => {
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
    }

    mappedClusters.forEach(addClusterRecords)
    cachedClusters.forEach(addClusterRecords)

    ;(workspaceWorks?.unclustered_works ?? []).forEach(work => {
      acc.push(stubWorkRecord(work.id, work.ark ?? undefined, work.title ?? null, work.title_segments ?? undefined))
    })

    return acc
  }, [workspaceWorks?.clusters, workspaceWorks?.unclustered_works, cachedClusters])

  const cachedRecords = useMemo<RecordRow[]>(() => {
    void cacheVersion
    const queries = queryClient.getQueriesData({ queryKey: ['workspace', 'record', datasetId] })
    return queries.map(([, payload]) => (payload ? buildRecordRowFromPayload(payload as unknown as WorkRecordPayload) : null)).filter((rec): rec is RecordRow => Boolean(rec))
  }, [datasetId, queryClient, cacheVersion])

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

  return { getById, getByArk }
}

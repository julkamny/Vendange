import { useCallback, useRef, type MutableRefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import { configureTabStateForRecord } from '../workspace/tabState'
import type { WorkspaceDataIndexes } from '../workspace/useWorkspaceData'
import { deriveInternalIdFromArk } from '../lib/ark'
import { fetchWorkspaceRecord, fetchWorkCluster } from '../lib/api'
import { buildRecordRowFromPayload } from '../lib/recordPayload'
import { isAgentRecord } from '../agents/useAgentData'
import { mapWorkCluster } from '../lib/mapWorkClusters'
import { expressionWorkArks, manifestationExpressionArks } from '../core/entities'
import { stubExpressionRecord, stubManifestationRecord, stubWorkRecord } from '../workspace/recordStubs'

export type WorkspaceContextSnapshot = {
  clusters: Cluster[]
  indexes: WorkspaceDataIndexes
}

export type RecordOpenOptions = { detach?: boolean }

type Params = {
  datasetId: string | null | undefined
  getWorkspaceContext?: () => WorkspaceContextSnapshot
  cacheRef?: MutableRefObject<Map<string, RecordRow>>
  onOpenWorkspaceTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenWorkspaceDetachedTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentDetachedTab: (initializer: (base: AgentTabState) => AgentTabState) => void
}

export const EMPTY_WORKSPACE_INDEXES: WorkspaceDataIndexes = {
  worksById: new Map(),
  worksByArk: new Map(),
  expressionsById: new Map(),
  expressionsByArk: new Map(),
  expressionsByWorkArk: new Map(),
  manifestationsById: new Map(),
  manifestationsByExpressionArk: new Map(),
}

export function useRecordOpener({
  datasetId,
  getWorkspaceContext,
  cacheRef,
  onOpenWorkspaceTab,
  onOpenWorkspaceDetachedTab,
  onOpenAgentTab,
  onOpenAgentDetachedTab,
}: Params) {
  const queryClient = useQueryClient()
  const fallbackCacheRef = useRef<Map<string, RecordRow>>(new Map())
  const recordCacheRef = cacheRef ?? fallbackCacheRef

  const rememberRecord = useCallback((entry: RecordRow | null) => {
    if (!entry) return
    recordCacheRef.current.set(entry.id, entry)
    if (entry.ark) recordCacheRef.current.set(entry.ark, entry)
  }, [recordCacheRef])

  const getById = useCallback((id: string) => recordCacheRef.current.get(id) ?? null, [recordCacheRef])
  const getByArk = useCallback((ark: string) => recordCacheRef.current.get(ark) ?? null, [recordCacheRef])

  const ensureRecord = useCallback(
    async (key: string | null | undefined) => {
      const trimmed = (key ?? '').trim()
      if (!trimmed) return null
      const cached = recordCacheRef.current.get(trimmed)
      if (cached) return cached
      if (!datasetId) return null
      try {
        const payload = await queryClient.fetchQuery({
          queryKey: ['workspace', 'record', datasetId, trimmed],
          queryFn: () => fetchWorkspaceRecord(datasetId, trimmed),
        })
        const entry = buildRecordRowFromPayload(payload)
        rememberRecord(entry)
        return entry
      } catch (error) {
        console.error('Failed to load record for key', trimmed, error)
        return null
      }
    },
    [datasetId, queryClient, rememberRecord, recordCacheRef],
  )

  const buildIndexesFromCluster = useCallback((cluster: Cluster): WorkspaceDataIndexes => {
    const worksById = new Map<string, RecordRow>()
    const worksByArk = new Map<string, RecordRow>()
    const expressionsById = new Map<string, RecordRow>()
    const expressionsByArk = new Map<string, RecordRow>()
    const expressionsByWorkArk = new Map<string, RecordRow[]>()
    const manifestationsById = new Map<string, RecordRow>()
    const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

    const addExpression = (expr: import('../types').ExpressionItem, workArk: string | undefined | null) => {
      const exprRow = stubExpressionRecord(expr, workArk ?? cluster.anchorArk)
      expressionsById.set(expr.id, exprRow)
      if (expr.ark) expressionsByArk.set(expr.ark, exprRow)
      const parentArk = workArk ?? cluster.anchorArk
      if (parentArk) {
        if (!expressionsByWorkArk.has(parentArk)) expressionsByWorkArk.set(parentArk, [])
        const list = expressionsByWorkArk.get(parentArk)!
        if (!list.some(item => item.id === expr.id)) list.push(exprRow)
      }
      (expr.manifestations || []).forEach(man => {
        const manRow = stubManifestationRecord(man, expr.ark ?? parentArk ?? null)
        manifestationsById.set(man.id, manRow)
        const exprArk = man.expressionArk || expr.ark || null
        if (exprArk) {
          if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
          const list = manifestationsByExpressionArk.get(exprArk)!
          if (!list.some(item => item.id === man.id)) list.push(manRow)
        }
      })
    }

    const addWork = (id: string | undefined, ark?: string | null, title?: string | null) => {
      if (!id && !ark) return
      const workRow = stubWorkRecord(id ?? ark ?? '', ark ?? undefined, title ?? null)
      if (workRow.id) worksById.set(workRow.id, workRow)
      if (workRow.ark) worksByArk.set(workRow.ark, workRow)
    }

    addWork(cluster.anchorId, cluster.anchorArk, cluster.anchorTitle ?? null)
    cluster.items.forEach(item => addWork(item.id, item.ark, item.title ?? null))

    cluster.expressionGroups?.forEach(group => {
      addExpression(group.anchor, cluster.anchorArk)
      group.clustered.forEach(expr => addExpression(expr, cluster.anchorArk))
    })
    cluster.independentExpressions?.forEach(expr => addExpression(expr, cluster.anchorArk))

    return {
      worksById,
      worksByArk,
      expressionsById,
      expressionsByArk,
      expressionsByWorkArk,
      manifestationsById,
      manifestationsByExpressionArk,
    }
  }, [])

  const mergeClusters = useCallback((existing: Cluster[], next: Cluster | null): Cluster[] => {
    if (!next) return existing
    const already = existing.find(c => c.anchorId === next.anchorId || (c.anchorArk && next.anchorArk && c.anchorArk === next.anchorArk))
    if (already) return existing
    return [...existing, next]
  }, [])

  const resolveAnchorKey = useCallback(
    async (record: RecordRow): Promise<{ anchorKey: string | null }> => {
      if (record.typeNorm === 'oeuvre') {
        return { anchorKey: record.ark ?? record.id }
      }
      if (record.typeNorm === 'expression') {
        const workArk = expressionWorkArks(record)[0] ?? null
        return { anchorKey: workArk }
      }
      if (record.typeNorm === 'manifestation') {
        const exprArk = manifestationExpressionArks(record)[0] ?? null
        if (!exprArk) return { anchorKey: null }
        const exprRecord = await ensureRecord(exprArk)
        const workArk = exprRecord ? expressionWorkArks(exprRecord)[0] ?? null : null
        return { anchorKey: workArk }
      }
      return { anchorKey: null }
    },
    [ensureRecord],
  )

  const openRecord = useCallback(
    async (record: RecordRow, options?: RecordOpenOptions) => {
      if (isAgentRecord(record)) {
        const initializer = (base: AgentTabState) => ({ ...base, selectedAgentId: record.id })
        if (options?.detach) onOpenAgentDetachedTab(initializer)
        else onOpenAgentTab(initializer)
        return
      }

      const baseContext =
        getWorkspaceContext?.() ?? {
          clusters: [],
          indexes: EMPTY_WORKSPACE_INDEXES,
        }

      const { anchorKey } = await resolveAnchorKey(record)
      let fetchedCluster: Cluster | null = null
      if (datasetId && anchorKey) {
        try {
          const dto = await queryClient.fetchQuery({
            queryKey: ['workspace', 'work', datasetId, anchorKey],
            queryFn: () => fetchWorkCluster(datasetId, anchorKey),
          })
          fetchedCluster = mapWorkCluster(dto)
        } catch (error) {
          console.warn('Failed to load work cluster for anchor', anchorKey, error)
        }
      }

      const mergedClusters = mergeClusters(baseContext.clusters, fetchedCluster)
      const indexes =
        fetchedCluster && fetchedCluster.anchorId
          ? buildIndexesFromCluster(fetchedCluster)
          : baseContext.indexes ?? EMPTY_WORKSPACE_INDEXES

      const ctx: WorkspaceContextSnapshot = {
        clusters: mergedClusters,
        indexes,
      }

      const initializer = (base: WorkspaceTabStateWorkspace) => configureTabStateForRecord(base, record, ctx)
      if (options?.detach) onOpenWorkspaceDetachedTab(initializer)
      else onOpenWorkspaceTab(initializer)
    },
    [
      buildIndexesFromCluster,
      datasetId,
      getWorkspaceContext,
      mergeClusters,
      onOpenAgentDetachedTab,
      onOpenAgentTab,
      onOpenWorkspaceDetachedTab,
      onOpenWorkspaceTab,
      queryClient,
      resolveAnchorKey,
    ],
  )

  const openRecordForArk = useCallback(
    async (ark: string, options?: RecordOpenOptions) => {
      const trimmed = ark.trim()
      if (!trimmed) return null
      let targetRecord = getByArk(trimmed)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmed)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!targetRecord) {
        targetRecord = await ensureRecord(trimmed)
      }
      if (!targetRecord) return null
      await openRecord(targetRecord, options)
      return targetRecord
    },
    [ensureRecord, getByArk, getById, openRecord],
  )

  return {
    recordCacheRef,
    getById,
    getByArk,
    rememberRecord,
    ensureRecord,
    openRecord,
    openRecordForArk,
  }
}

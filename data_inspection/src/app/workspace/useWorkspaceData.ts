import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { titleOf, manifestationsForExpression } from '../core/entities'
import type { Cluster, RecordRow, WorkListRowDto } from '../types'
import type { WorkspaceTabStateWorkspace } from './types'
import { useWorkCluster, useWorkspaceWorks } from '../hooks/useWorkspaceQueries'
import { mapWorkCluster, mapWorkClusters } from '../lib/mapWorkClusters'
import { stubExpressionRecord, stubManifestationRecord, stubWorkRecord } from './recordStubs'

export type WorkspaceDataIndexes = {
  worksById: Map<string, RecordRow>
  worksByArk: Map<string, RecordRow>
  expressionsById: Map<string, RecordRow>
  expressionsByArk: Map<string, RecordRow>
  expressionsByWorkArk: Map<string, RecordRow[]>
  manifestationsById: Map<string, RecordRow>
  manifestationsByExpressionArk: Map<string, RecordRow[]>
}

export function useWorkspaceData(state: WorkspaceTabStateWorkspace) {
  const { clusters: localClusters, datasetId } = useAppData()
  const { data: workspaceData } = useWorkspaceWorks(datasetId)
  const anchorKey = state.activeWorkAnchorId ?? state.highlightedWorkArk ?? null
  const { data: activeClusterDto } = useWorkCluster(datasetId, anchorKey)
  const activeClusterOverride = useMemo(
    () => (activeClusterDto ? mapWorkCluster(activeClusterDto) : null),
    [activeClusterDto],
  )

  const mappedClusters = useMemo(() => (workspaceData?.clusters ? mapWorkClusters(workspaceData.clusters) : null), [workspaceData?.clusters])

  const clusters = mappedClusters ?? localClusters

  const coverage = useMemo(() => computeClusterCoverage(clusters), [clusters])

  const unclusteredWorkRows = useMemo<WorkListRowDto[]>(() => workspaceData?.unclustered_works ?? [], [workspaceData?.unclustered_works])
  const orderedWorkEntries = useMemo(() => workspaceData?.ordered_work_entries ?? null, [workspaceData?.ordered_work_entries])

  const unclusteredWorks = useMemo(
    () =>
      (workspaceData?.unclustered_works ?? []).map(entry =>
        stubWorkRecord(entry.id, entry.ark ?? undefined, entry.title ?? null, entry.title_segments ?? undefined),
      ),
    [workspaceData?.unclustered_works],
  )

  const dataIndexes = useMemo<WorkspaceDataIndexes>(() => {
    const worksById = new Map<string, RecordRow>()
    const worksByArk = new Map<string, RecordRow>()
    const expressionsById = new Map<string, RecordRow>()
    const expressionsByArk = new Map<string, RecordRow>()
    const expressionsByWorkArk = new Map<string, RecordRow[]>()
    const manifestationsById = new Map<string, RecordRow>()
    const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

    const clusterSource = mappedClusters ?? []
    clusterSource.forEach(cluster => {
      const addExpression = (expr: import('../types').ExpressionItem) => {
        const exprRow = stubExpressionRecord(expr, cluster.anchorArk)
        expressionsById.set(exprRow.id, exprRow)
        if (exprRow.ark) expressionsByArk.set(exprRow.ark, exprRow)
        const workArk = cluster.anchorArk
        if (workArk) {
          if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
          const list = expressionsByWorkArk.get(workArk)!
          if (!list.some(item => item.id === exprRow.id)) list.push(exprRow)
        }
        expr.manifestations.forEach(man => {
          const manRow = stubManifestationRecord(man, expr.ark ?? workArk)
          manifestationsById.set(manRow.id, manRow)
          const exprArk = man.expressionArk || expr.ark
          if (exprArk) {
            if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
            const list = manifestationsByExpressionArk.get(exprArk)!
            if (!list.some(item => item.id === manRow.id)) list.push(manRow)
          }
        })
      }

    const addWork = (
      id: string | undefined,
      ark?: string,
      title?: string | null,
      titleSegments?: RecordRow['titleSegments'],
    ) => {
      if (!id && !ark) return
      const workRow = stubWorkRecord(id ?? ark ?? '', ark, title ?? null, titleSegments)
      worksById.set(workRow.id, workRow)
      if (workRow.ark) worksByArk.set(workRow.ark, workRow)
    }

    addWork(cluster.anchorId, cluster.anchorArk, cluster.anchorTitle ?? null, cluster.anchorTitleSegments)
    cluster.items.forEach(item => addWork(item.id, item.ark, item.title ?? null, item.titleSegments))
      cluster.expressionGroups.forEach(group => {
        addExpression(group.anchor)
        group.clustered.forEach(expr => addExpression(expr))
      })
      cluster.independentExpressions.forEach(expr => addExpression(expr))
    })

    unclusteredWorkRows.forEach(entry => {
      const workRow = stubWorkRecord(entry.id, entry.ark ?? undefined, entry.title ?? null, entry.title_segments ?? undefined)
      worksById.set(workRow.id, workRow)
      if (workRow.ark) worksByArk.set(workRow.ark, workRow)
    })

    return {
      worksById,
      worksByArk,
      expressionsById,
      expressionsByArk,
      expressionsByWorkArk,
      manifestationsById,
      manifestationsByExpressionArk,
    }
  }, [mappedClusters, unclusteredWorkRows])

  const activeContext = useMemo(() => {
    const selectedWorkId = state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null
    const candidateWorkRecord =
      (selectedWorkId ? dataIndexes.worksById.get(selectedWorkId) ?? null : null) ||
      (state.highlightedWorkArk ? dataIndexes.worksByArk.get(state.highlightedWorkArk) ?? null : null)

    if (activeClusterOverride) {
      const matchesAnchor =
        (state.activeWorkAnchorId && activeClusterOverride.anchorId === state.activeWorkAnchorId) ||
        (state.highlightedWorkArk && activeClusterOverride.anchorArk === state.highlightedWorkArk)
      if (matchesAnchor) {
        return { cluster: activeClusterOverride, source: 'cluster' as const, inventoryWork: null as RecordRow | null }
      }
    }

    if (state.activeWorkAnchorId) {
      const cluster = clusters.find(entry => entry.anchorId === state.activeWorkAnchorId) ?? null
      if (cluster) {
        return { cluster, source: 'cluster' as const, inventoryWork: null as RecordRow | null }
      }
    }

    if (candidateWorkRecord) {
      const existingCluster = clusters.find(c => {
        if (c.anchorId === candidateWorkRecord.id) return true
        return c.items.some(item => item.id === candidateWorkRecord.id || (candidateWorkRecord.ark && item.ark === candidateWorkRecord.ark))
      })

      if (existingCluster) {
        return { cluster: existingCluster, source: 'cluster' as const, inventoryWork: null as RecordRow | null }
      }

      const workArk = candidateWorkRecord.ark || state.highlightedWorkArk || ''
      const expressionRecords = workArk ? dataIndexes.expressionsByWorkArk.get(workArk) ?? [] : []
      const independentExpressions = expressionRecords.map(expr => {
        const expressionArk = expr.ark
        const manifestations =
          expressionArk && expressionArk.length > 0
            ? manifestationsForExpression(
              expressionArk,
              dataIndexes.manifestationsByExpressionArk,
              dataIndexes.expressionsByArk,
            )
            : []
        return {
          id: expr.id,
          ark: expressionArk || expr.id,
          title: titleOf(expr) || expr.id,
          workArk,
          workId: candidateWorkRecord.id,
          manifestations,
        }
      })
      const pseudoCluster: Cluster = {
        anchorId: candidateWorkRecord.id,
        anchorArk: workArk,
        anchorTitle: titleOf(candidateWorkRecord),
        anchor_summary: null,
        anchorSummary: null,
        items: [],
        expressionGroups: [],
        independentExpressions,
      }
      return { cluster: pseudoCluster, source: 'inventory' as const, inventoryWork: candidateWorkRecord }
    }

      if (activeClusterOverride) {
        return { cluster: activeClusterOverride, source: 'cluster' as const, inventoryWork: null as RecordRow | null }
      }

    return { cluster: null, source: 'none' as const, inventoryWork: null as RecordRow | null }
  }, [
    activeClusterOverride,
    clusters,
    dataIndexes.expressionsByArk,
    dataIndexes.expressionsByWorkArk,
    dataIndexes.manifestationsByExpressionArk,
    dataIndexes.worksByArk,
    dataIndexes.worksById,
    state.activeWorkAnchorId,
    state.highlightedWorkArk,
    state.selectedEntity,
  ])

  return {
    clusters,
    unclusteredWorks,
    unclusteredWorkRows,
    orderedWorkEntries,
    coverage,
    activeCluster: activeContext.cluster,
    activeClusterSource: activeContext.source,
    inventoryWork: activeContext.inventoryWork,
    indexes: dataIndexes,
  }
}

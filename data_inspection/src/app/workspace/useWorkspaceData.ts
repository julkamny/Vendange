import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { getUnclusteredWorks } from '../core/unclustered'
import { useTranslation } from '../hooks/useTranslation'
import { titleOf, expressionWorkArks, manifestationsForExpression, manifestationExpressionArks } from '../core/entities'
import type { Cluster, RecordRow, WorkListRowDto } from '../types'
import type { WorkspaceTabStateWorkspace } from './types'
import { useWorkCluster, useWorkspaceWorks } from '../hooks/useWorkspaceQueries'
import { mapWorkCluster, mapWorkClusters } from '../lib/mapWorkClusters'

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
  const { clusters: localClusters, curated, datasetId } = useAppData()
  const { language } = useTranslation()
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

  const unclusteredWorkRows = useMemo<WorkListRowDto[]>(
    () => workspaceData?.unclustered_works ?? [],
    [workspaceData?.unclustered_works],
  )

  const unclusteredWorks = useMemo(() => {
    if (workspaceData?.unclustered_works && curated?.records) {
      const byId = new Map<string, RecordRow>()
      curated.records.forEach(rec => byId.set(rec.id, rec))
      const byArk = new Map<string, RecordRow>()
      curated.records.forEach(rec => {
        if (rec.ark) byArk.set(rec.ark, rec)
      })
      return workspaceData.unclustered_works
        .map(entry => byId.get(entry.id) ?? (entry.ark ? byArk.get(entry.ark) : undefined))
        .filter((rec): rec is RecordRow => Boolean(rec))
    }
    if (!curated) return []
    return getUnclusteredWorks(curated.records, coverage, language)
  }, [curated, coverage, language, workspaceData?.unclustered_works])

  const dataIndexes = useMemo<WorkspaceDataIndexes>(() => {
    const worksById = new Map<string, RecordRow>()
    const worksByArk = new Map<string, RecordRow>()
    const expressionsById = new Map<string, RecordRow>()
    const expressionsByArk = new Map<string, RecordRow>()
    const expressionsByWorkArk = new Map<string, RecordRow[]>()
    const manifestationsById = new Map<string, RecordRow>()
    const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

    const addRecords = (records: RecordRow[] | undefined | null) => {
      if (!records) return
      for (const rec of records) {
        if (rec.typeNorm === 'oeuvre') {
          worksById.set(rec.id, rec)
          if (rec.ark) worksByArk.set(rec.ark, rec)
          continue
        }
        if (rec.typeNorm === 'expression') {
          expressionsById.set(rec.id, rec)
          if (rec.ark) expressionsByArk.set(rec.ark, rec)
          const workArks = expressionWorkArks(rec)
          for (const workArk of workArks) {
            if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
            const list = expressionsByWorkArk.get(workArk)!
            if (!list.some(existing => existing.id === rec.id)) {
              list.push(rec)
            }
          }
          continue
        }
        if (rec.typeNorm === 'manifestation') {
          manifestationsById.set(rec.id, rec)
          for (const exprArk of manifestationExpressionArks(rec)) {
            if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
            const list = manifestationsByExpressionArk.get(exprArk)!
            if (!list.some(existing => existing.id === rec.id)) {
              list.push(rec)
            }
          }
        }
      }
    }

    addRecords(curated?.records ?? null)

    return {
      worksById,
      worksByArk,
      expressionsById,
      expressionsByArk,
      expressionsByWorkArk,
      manifestationsById,
      manifestationsByExpressionArk,
    }
  }, [curated?.records])

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
    coverage,
    activeCluster: activeContext.cluster,
    activeClusterSource: activeContext.source,
    inventoryWork: activeContext.inventoryWork,
    indexes: dataIndexes,
  }
}

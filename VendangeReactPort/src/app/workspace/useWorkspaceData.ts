import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { getUnclusteredWorks } from '../core/unclustered'
import { useTranslation } from '../hooks/useTranslation'
import { titleOf, expressionWorkArks, manifestationsForExpression, manifestationExpressionArks } from '../core/entities'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabState } from './types'

export function useWorkspaceData(state: WorkspaceTabState) {
  const { clusters, original, curated } = useAppData()
  const { language } = useTranslation()

  const coverage = useMemo(() => computeClusterCoverage(clusters), [clusters])
  const unclusteredWorks = useMemo(() => {
    if (!original) return []
    return getUnclusteredWorks(original.records, coverage, language)
  }, [original, coverage, language])

  const dataIndexes = useMemo(() => {
    const worksById = new Map<string, RecordRow>()
    const worksByArk = new Map<string, RecordRow>()
    const expressionsByArk = new Map<string, RecordRow>()
    const expressionsByWorkArk = new Map<string, RecordRow[]>()
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

    addRecords(original?.records ?? null)
    addRecords(curated?.records ?? null)

    return {
      worksById,
      worksByArk,
      expressionsByArk,
      expressionsByWorkArk,
      manifestationsByExpressionArk,
    }
  }, [original?.records, curated?.records])

  const activeContext = useMemo(() => {
    if (state.listScope === 'inventory') {
      const targetWorkId = state.inventoryFocusWorkId
      const targetWorkArk = state.highlightedWorkArk ?? null
      const workRecord =
        (targetWorkId ? dataIndexes.worksById.get(targetWorkId) ?? null : null) ||
        (targetWorkArk ? dataIndexes.worksByArk.get(targetWorkArk) ?? null : null)
      if (!workRecord) {
        return { cluster: null as Cluster | null, source: 'none' as const, inventoryWork: null as RecordRow | null }
      }
      const workArk = workRecord.ark || targetWorkArk || ''
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
          workId: workRecord.id,
          manifestations,
        }
      })
      const pseudoCluster: Cluster = {
        anchorId: workRecord.id,
        anchorArk: workArk,
        anchorTitle: titleOf(workRecord),
        items: [],
        expressionGroups: [],
        independentExpressions,
      }
      return {
        cluster: pseudoCluster,
        source: 'inventory' as const,
        inventoryWork: workRecord,
      }
    }

    let cluster: Cluster | null = null
    if (state.activeWorkAnchorId) {
      cluster = clusters.find(entry => entry.anchorId === state.activeWorkAnchorId) ?? null
    } else {
      cluster = clusters[0] ?? null
    }
    return {
      cluster,
      source: cluster ? ('cluster' as const) : ('none' as const),
      inventoryWork: null as RecordRow | null,
    }
  }, [
    state.listScope,
    state.inventoryFocusWorkId,
    state.highlightedWorkArk,
    state.activeWorkAnchorId,
    clusters,
    dataIndexes,
  ])

  return {
    clusters,
    unclusteredWorks,
    coverage,
    activeCluster: activeContext.cluster,
    activeClusterSource: activeContext.source,
    inventoryWork: activeContext.inventoryWork,
  }
}

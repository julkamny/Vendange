import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { getUnclusteredWorks } from '../core/unclustered'
import { useTranslation } from '../hooks/useTranslation'
import { titleOf, expressionWorkArks, manifestationsForExpression, manifestationExpressionArks } from '../core/entities'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace } from './types'

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
  const { clusters, curated } = useAppData()
  const { language } = useTranslation()

  const coverage = useMemo(() => computeClusterCoverage(clusters), [clusters])
  const unclusteredWorks = useMemo(() => {
    if (!curated) return []
    return getUnclusteredWorks(curated.records, coverage, language)
  }, [curated, coverage, language])

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
    console.log('state', state)
    if (state.listScope === 'clusters') {
      const targetWorkId = state.inventoryFocusWorkId
      const targetWorkArk = state.highlightedWorkArk ?? null
      const workRecord =
        (targetWorkId ? dataIndexes.worksById.get(targetWorkId) ?? null : null) ||
        (targetWorkArk ? dataIndexes.worksByArk.get(targetWorkArk) ?? null : null)
      console.log('workRecord', workRecord, targetWorkId, targetWorkArk)
      if (!workRecord) {
        return { cluster: null as Cluster | null, source: 'none' as const, inventoryWork: null as RecordRow | null }
      }

      // Check if this work is actually a cluster anchor OR part of a cluster
      const existingCluster = clusters.find(c => {
        if (c.anchorId === workRecord.id) return true
        // Check if the work is one of the clustered items
        if (c.items.some(item => item.id === workRecord.id || (workRecord.ark && item.ark === workRecord.ark))) {
          console.log('found cluster', c)
          return true
        }
        return false
      })
      if (existingCluster) {
        return {
          cluster: existingCluster,
          source: 'cluster' as const,
          inventoryWork: null as RecordRow | null,
        }
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

    if (cluster) {
      return {
        cluster,
        source: 'cluster' as const,
        inventoryWork: null as RecordRow | null,
      }
    }

    // Fallback: if we were looking for a cluster but it's gone (e.g. unclustered),
    // try to show the work as an inventory item if we have the ID.
    if (state.activeWorkAnchorId) {
      const workRecord = dataIndexes.worksById.get(state.activeWorkAnchorId)
      if (workRecord) {
        const workArk = workRecord.ark || ''
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
    }

    return {
      cluster: null,
      source: 'none' as const,
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
    indexes: dataIndexes,
  }
}

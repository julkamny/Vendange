import type { RecordRow, Cluster } from '../types'
import type { WorkspaceTabStateWorkspace } from './types'
import type { WorkspaceDataIndexes } from './useWorkspaceData'
import {
  expressionWorkArks,
  manifestationExpressionArks,
  findExpressionInCluster,
  titleOf,
  manifestationTitle,
} from '../core/entities'
import { inferRecordSource, resolveAnchorExpressionId } from './shortcutActions'

type WorkspaceTabBuildContext = {
  clusters: Cluster[]
  indexes: WorkspaceDataIndexes
  curatedRecords: RecordRow[]
}

export function configureTabStateForRecord(
  base: WorkspaceTabStateWorkspace,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabStateWorkspace {
  if (record.typeNorm === 'oeuvre') {
    return configureForWork(base, record, ctx)
  }
  if (record.typeNorm === 'expression') {
    return configureForExpression(base, record, ctx)
  }
  if (record.typeNorm === 'manifestation') {
    console.log('--- WorkspaceTabState (base) ---')
    console.log(base)
    console.log('--- Record (manifestation) ---')
    console.log(record)
    console.log('--- WorkspaceTabBuildContext (ctx) ---')
    console.log(ctx)
    return configureForManifestation(base, record, ctx)
  }
  return base
}

function configureForWork(
  base: WorkspaceTabStateWorkspace,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabStateWorkspace {
  const workArk = record.ark ?? null
  const cluster = findClusterForWork(ctx.clusters, record.id, workArk)
  const source = inferRecordSource(record.id, ctx.curatedRecords)
  const highlightedWorkArk = workArk ?? cluster?.anchorArk ?? null
  const workArkForEntity = workArk ?? cluster?.anchorArk ?? undefined

  if (cluster) {
    return {
      ...base,
      title: titleOf(record) || base.title,
      viewMode: 'works',
      activeWorkAnchorId: cluster.anchorId,
      highlightedWorkId: record.id,
      highlightedWorkArk,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      selectedEntity: {
        id: record.id,
        source,
        entityType: 'work',
        workArk: workArkForEntity,
        clusterAnchorId: cluster.anchorId,
        isAnchor: record.id === cluster.anchorId,
      },
    }
  }

  return {
    ...base,
    title: titleOf(record) || base.title,
    listScope: 'clusters',
    viewMode: 'works',
    activeWorkAnchorId: null,
    highlightedWorkId: record.id,
    highlightedWorkArk,
    activeExpressionAnchorId: null,
    highlightedExpressionArk: null,
    selectedEntity: {
      id: record.id,
      source,
      entityType: 'work',
      workArk: workArkForEntity,
    },
  }
}

function configureForExpression(
  base: WorkspaceTabStateWorkspace,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabStateWorkspace {
  const expressionArk = record.ark ?? null
  const workArk = expressionWorkArks(record)[0] ?? null
  const workRecord = workArk ? ctx.indexes.worksByArk.get(workArk) ?? null : null
  const cluster = findClusterForExpression(ctx.clusters, record.id, expressionArk)
  const expressionInCluster = cluster
    ? findExpressionInCluster(cluster, record.id, expressionArk ?? undefined)
    : undefined
  const anchorId = cluster ? resolveAnchorExpressionId(cluster, expressionInCluster) : null
  const source = inferRecordSource(record.id, ctx.curatedRecords)
  const highlightedWorkArk = workArk ?? cluster?.anchorArk ?? null
  const expressionArkForState = expressionArk ?? expressionInCluster?.ark ?? null
  const selectedEntity = {
    id: record.id,
    source,
    entityType: 'expression' as const,
    workArk: highlightedWorkArk ?? undefined,
    expressionId: record.id,
    expressionArk: expressionArkForState ?? undefined,
    clusterAnchorId: cluster?.anchorId,
    isAnchor: !!anchorId && anchorId === record.id,
  }

  if (cluster) {
    return {
      ...base,
      title: titleOf(workRecord ?? record) || base.title,
      viewMode: 'expressions',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedWorkId: cluster.anchorId,
      highlightedWorkArk,
      highlightedExpressionArk: expressionArkForState,
      selectedEntity,
    }
  }

  return {
    ...base,
    title: titleOf(workRecord ?? record) || base.title,
    listScope: 'clusters',
    viewMode: 'expressions',
    activeWorkAnchorId: null,
    activeExpressionAnchorId: null,
    highlightedWorkId: workRecord?.id ?? null,
    highlightedWorkArk,
    highlightedExpressionArk: expressionArkForState,
    selectedEntity,
  }
}

function configureForManifestation(
  base: WorkspaceTabStateWorkspace,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabStateWorkspace {
  const expressionArk = manifestationExpressionArks(record)[0] ?? null
  const expressionRecord = expressionArk ? ctx.indexes.expressionsByArk.get(expressionArk) ?? null : null
  const expressionId = expressionRecord?.id ?? null
  const workArkCandidates = expressionRecord ? expressionWorkArks(expressionRecord) : []
  const workArk = workArkCandidates[0] ?? null
  const workRecord = workArk ? ctx.indexes.worksByArk.get(workArk) ?? null : null
  const clusterFromIndexes = expressionRecord ? findClusterForExpression(ctx.clusters, expressionId, expressionArk) : null

  const manifestationNeedles = [record.id, record.ark].filter(Boolean) as string[]
  const manifestationCluster = findClusterContainingManifestation(ctx.clusters, manifestationNeedles)
  const expressionInCluster =
    manifestationCluster && manifestationCluster.expression
      ? manifestationCluster.expression
      : clusterFromIndexes
        ? findExpressionInCluster(clusterFromIndexes, expressionId ?? undefined, expressionArk ?? undefined)
        : undefined

  const anchorId = manifestationCluster
    ? manifestationCluster.anchorExpressionId
    : clusterFromIndexes
      ? resolveAnchorExpressionId(clusterFromIndexes, expressionInCluster)
      : null
  const source = inferRecordSource(record.id, ctx.curatedRecords)
  const highlightedWorkArk = workArk ?? manifestationCluster?.cluster.anchorArk ?? clusterFromIndexes?.anchorArk ?? null
  const expressionArkForState =
    expressionArk ??
    expressionInCluster?.ark ??
    expressionRecord?.ark ??
    null

  console.log('Manifestation configuration', {
    record,
    workRecord,
    expressionRecord,
    manifestationCluster,
    clusterFromIndexes,
    expressionInCluster,
  })

  const selectedEntity = {
    id: record.id,
    source,
    entityType: 'manifestation' as const,
    workArk: highlightedWorkArk ?? undefined,
    expressionId: expressionId ?? undefined,
    expressionArk: expressionArkForState ?? undefined,
    clusterAnchorId: manifestationCluster?.cluster.anchorId ?? clusterFromIndexes?.anchorId,
    isAnchor: false,
  }

  if (manifestationCluster || clusterFromIndexes) {
    const resolvedCluster = manifestationCluster?.cluster ?? clusterFromIndexes
    return {
      ...base,
      title: manifestationTitle(record) || titleOf(expressionRecord ?? workRecord ?? record) || base.title,
      viewMode: 'manifestations',
      activeWorkAnchorId: resolvedCluster?.anchorId ?? null,
      activeExpressionAnchorId: anchorId,
      highlightedWorkId: resolvedCluster?.anchorId ?? workRecord?.id ?? null,
      highlightedWorkArk,
      highlightedExpressionArk: expressionArkForState,
      selectedEntity,
    }
  }

  return {
    ...base,
    title: manifestationTitle(record) || titleOf(expressionRecord ?? workRecord ?? record) || base.title,
    listScope: 'clusters',
    viewMode: 'manifestations',
    activeWorkAnchorId: workArk ?? null,
    activeExpressionAnchorId: null,
    highlightedWorkId: workRecord?.id ?? null,
    highlightedWorkArk,
    highlightedExpressionArk: expressionArkForState,
    selectedEntity,
  }
}

function findClusterForWork(clusters: Cluster[], workId: string, workArk: string | null): Cluster | null {
  const byId = clusters.find(cluster => cluster.anchorId === workId) ?? null
  if (byId) return byId
  if (!workArk) return null
  return (
    clusters.find(cluster => cluster.anchorArk === workArk) ??
    clusters.find(cluster => cluster.items.some(item => item.ark === workArk)) ??
    null
  )
}

function findClusterForExpression(
  clusters: Cluster[],
  expressionId?: string | null,
  expressionArk?: string | null,
): Cluster | null {
  if (!expressionId && !expressionArk) return null
  return (
    clusters.find(cluster => !!findExpressionInCluster(cluster, expressionId ?? undefined, expressionArk ?? undefined)) ??
    null
  )
}

function findClusterContainingManifestation(
  clusters: Cluster[],
  needles: string[],
): { cluster: Cluster; expression: import('../types').ExpressionItem | import('../types').ExpressionClusterItem; anchorExpressionId: string | null } | null {
  for (const cluster of clusters) {
    const expressionGroups = cluster.expressionGroups ?? []
    for (const group of expressionGroups) {
      const anchorExpression = group.anchor
      const anchorMatch = anchorExpression.manifestations.find(item => needles.includes(item.id) || (item.ark && needles.includes(item.ark)))
      if (anchorMatch) {
        return { cluster, expression: anchorExpression, anchorExpressionId: anchorExpression.id }
      }
      for (const clustered of group.clustered) {
        const match = clustered.manifestations.find(item => needles.includes(item.id) || (item.ark && needles.includes(item.ark)))
        if (match) {
          const anchorExpressionId = clustered.anchorExpressionId ?? group.anchor.id ?? null
          return { cluster, expression: clustered, anchorExpressionId }
        }
      }
    }
    for (const expression of cluster.independentExpressions ?? []) {
      const match = expression.manifestations.find(item => needles.includes(item.id) || (item.ark && needles.includes(item.ark)))
      if (match) {
        return { cluster, expression, anchorExpressionId: expression.id }
      }
    }
  }
  return null
}

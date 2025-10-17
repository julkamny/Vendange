import type { RecordRow, Cluster } from '../types'
import type { WorkspaceTabState } from './types'
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
  originalRecords: RecordRow[]
}

export function configureTabStateForRecord(
  base: WorkspaceTabState,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabState {
  if (record.typeNorm === 'oeuvre') {
    return configureForWork(base, record, ctx)
  }
  if (record.typeNorm === 'expression') {
    return configureForExpression(base, record, ctx)
  }
  if (record.typeNorm === 'manifestation') {
    return configureForManifestation(base, record, ctx)
  }
  return base
}

function configureForWork(
  base: WorkspaceTabState,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabState {
  const workArk = record.ark ?? null
  const cluster = findClusterForWork(ctx.clusters, record.id, workArk)
  const source = inferRecordSource(record.id, ctx.curatedRecords, ctx.originalRecords)
  const highlightedWorkArk = workArk ?? cluster?.anchorArk ?? null
  const workArkForEntity = workArk ?? cluster?.anchorArk ?? undefined

  if (cluster) {
    return {
      ...base,
      title: titleOf(record) || base.title,
      listScope: 'clusters',
      viewMode: 'works',
      activeWorkAnchorId: cluster.anchorId,
      highlightedWorkArk,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
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
    listScope: 'inventory',
    viewMode: 'works',
    activeWorkAnchorId: null,
    highlightedWorkArk,
    activeExpressionAnchorId: null,
    highlightedExpressionArk: null,
    inventoryFocusWorkId: record.id,
    inventoryFocusExpressionId: null,
    selectedEntity: {
      id: record.id,
      source,
      entityType: 'work',
      workArk: workArkForEntity,
    },
  }
}

function configureForExpression(
  base: WorkspaceTabState,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabState {
  const expressionArk = record.ark ?? null
  const workArk = expressionWorkArks(record)[0] ?? null
  const workRecord = workArk ? ctx.indexes.worksByArk.get(workArk) ?? null : null
  const cluster = findClusterForExpression(ctx.clusters, record.id, expressionArk)
  const expressionInCluster = cluster
    ? findExpressionInCluster(cluster, record.id, expressionArk ?? undefined)
    : undefined
  const anchorId = cluster ? resolveAnchorExpressionId(cluster, expressionInCluster) : null
  const source = inferRecordSource(record.id, ctx.curatedRecords, ctx.originalRecords)
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
      listScope: 'clusters',
      viewMode: 'expressions',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedWorkArk,
      highlightedExpressionArk: expressionArkForState,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity,
    }
  }

  return {
    ...base,
    title: titleOf(workRecord ?? record) || base.title,
    listScope: 'inventory',
    viewMode: 'expressions',
    activeWorkAnchorId: null,
    activeExpressionAnchorId: null,
    highlightedWorkArk,
    highlightedExpressionArk: expressionArkForState,
    inventoryFocusWorkId: workRecord?.id ?? null,
    inventoryFocusExpressionId: record.id,
    selectedEntity,
  }
}

function configureForManifestation(
  base: WorkspaceTabState,
  record: RecordRow,
  ctx: WorkspaceTabBuildContext,
): WorkspaceTabState {
  const expressionArk = manifestationExpressionArks(record)[0] ?? null
  const expressionRecord = expressionArk ? ctx.indexes.expressionsByArk.get(expressionArk) ?? null : null
  const expressionId = expressionRecord?.id ?? null
  const workArkCandidates = expressionRecord ? expressionWorkArks(expressionRecord) : []
  const workArk = workArkCandidates[0] ?? null
  const workRecord = workArk ? ctx.indexes.worksByArk.get(workArk) ?? null : null
  const cluster = expressionRecord ? findClusterForExpression(ctx.clusters, expressionId, expressionArk) : null
  const expressionInCluster = cluster
    ? findExpressionInCluster(cluster, expressionId ?? undefined, expressionArk ?? undefined)
    : undefined
  const anchorId = cluster ? resolveAnchorExpressionId(cluster, expressionInCluster) : null
  const source = inferRecordSource(record.id, ctx.curatedRecords, ctx.originalRecords)
  const highlightedWorkArk = workArk ?? cluster?.anchorArk ?? null
  const expressionArkForState =
    expressionArk ??
    expressionInCluster?.ark ??
    expressionRecord?.ark ??
    null

  const selectedEntity = {
    id: record.id,
    source,
    entityType: 'manifestation' as const,
    workArk: highlightedWorkArk ?? undefined,
    expressionId: expressionId ?? undefined,
    expressionArk: expressionArkForState ?? undefined,
    clusterAnchorId: cluster?.anchorId,
    isAnchor: false,
  }

  if (cluster) {
    return {
      ...base,
      title: manifestationTitle(record) || titleOf(expressionRecord ?? workRecord ?? record) || base.title,
      listScope: 'clusters',
      viewMode: 'manifestations',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedWorkArk,
      highlightedExpressionArk: expressionArkForState,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity,
    }
  }

  return {
    ...base,
    title: manifestationTitle(record) || titleOf(expressionRecord ?? workRecord ?? record) || base.title,
    listScope: 'inventory',
    viewMode: 'manifestations',
    activeWorkAnchorId: null,
    activeExpressionAnchorId: null,
    highlightedWorkArk,
    highlightedExpressionArk: expressionArkForState,
    inventoryFocusWorkId: workRecord?.id ?? null,
    inventoryFocusExpressionId: expressionId,
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

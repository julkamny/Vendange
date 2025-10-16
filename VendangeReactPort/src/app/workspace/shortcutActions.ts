import { findExpressionInCluster, findPrimaryExpressionForWork } from '../core/entities'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabState } from './types'

type ShortcutContext = {
  clusters: Cluster[]
  activeCluster: Cluster | null
  curatedRecords: RecordRow[]
  originalRecords: RecordRow[]
}

export function focusTreeUp(state: WorkspaceTabState, ctx: ShortcutContext): WorkspaceTabState {
  if (state.listScope === 'inventory') return state
  const selected = state.selectedEntity
  if (!selected) return state

  if (selected.entityType === 'manifestation') {
    const cluster =
      resolveClusterForExpression(state, ctx, selected.expressionId ?? null, selected.expressionArk ?? null) ??
      resolveClusterForWork(state, ctx, selected.workArk ?? null, null)
    if (!cluster) return state

    const expression = findExpressionInCluster(cluster, selected.expressionId, selected.expressionArk)
    if (!expression) return state

    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionId = selected.expressionId ?? expression.id
    if (!expressionId) return state
    const expressionArk = expression.ark ?? selected.expressionArk ?? null
    const workArk = expression.workArk ?? cluster.anchorArk ?? null

    return {
      ...state,
      viewMode: 'expressions',
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk ?? null,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: expressionId,
        source: inferRecordSource(expressionId, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'expression',
        workArk: workArk ?? undefined,
        expressionId,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expressionId,
      },
    }
  }

  if (selected.entityType === 'expression') {
    const cluster =
      resolveClusterForExpression(state, ctx, selected.expressionId ?? null, selected.expressionArk ?? null) ??
      resolveClusterForWork(state, ctx, selected.workArk ?? null, null)
    if (!cluster) return state

    const expression = findExpressionInCluster(cluster, selected.expressionId, selected.expressionArk)
    const workArk =
      selected.workArk ?? expression?.workArk ?? (selected.expressionArk ? cluster.anchorArk : null) ?? cluster.anchorArk

    const nextWorkId =
      (expression && 'workId' in expression && expression.workId) ||
      (workArk ? cluster.items.find(item => item.ark === workArk)?.id : undefined) ||
      cluster.anchorId

    return {
      ...state,
      viewMode: 'works',
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: nextWorkId,
        source: inferRecordSource(nextWorkId, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'work',
        workArk: workArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: nextWorkId === cluster.anchorId,
      },
    }
  }

  return state
}

export function focusTreeDown(state: WorkspaceTabState, ctx: ShortcutContext): WorkspaceTabState {
  if (state.listScope === 'inventory') return state
  const selected = state.selectedEntity
  if (!selected) return state

  if (selected.entityType === 'work') {
    const workArk = selected.workArk ?? state.highlightedWorkArk ?? null
    const cluster = resolveClusterForWork(state, ctx, workArk, selected.id)
    if (!cluster) return state
    const targetWorkArk = workArk ?? cluster.anchorArk
    const expression = findPrimaryExpressionForWork(cluster, targetWorkArk)

    const baseState: WorkspaceTabState = {
      ...state,
      viewMode: 'expressions',
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkArk: targetWorkArk ?? null,
      inventoryFocusExpressionId: null,
    }

    if (!expression) {
      return baseState
    }

    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionId = expression.id
    const expressionArk = expression.ark ?? null

    return {
      ...baseState,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk,
      selectedEntity: {
        id: expressionId,
        source: inferRecordSource(expressionId, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'expression',
        workArk: expression.workArk ?? targetWorkArk ?? undefined,
        expressionId,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expressionId,
      },
    }
  }

  if (selected.entityType === 'expression') {
    const cluster =
      resolveClusterForExpression(state, ctx, selected.expressionId ?? null, selected.expressionArk ?? null) ??
      resolveClusterForWork(state, ctx, selected.workArk ?? null, null)
    if (!cluster) return state

    const expression = findExpressionInCluster(cluster, selected.expressionId, selected.expressionArk)
    if (!expression) return state

    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionArk = expression.ark ?? selected.expressionArk ?? null
    const baseState: WorkspaceTabState = {
      ...state,
      viewMode: 'manifestations',
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk ?? null,
      highlightedWorkArk: expression.workArk ?? state.highlightedWorkArk ?? null,
      inventoryFocusExpressionId: null,
    }

    const nextManifest = expression.manifestations[0]
    if (!nextManifest) {
      return baseState
    }

    return {
      ...baseState,
      selectedEntity: {
        id: nextManifest.id,
        source: inferRecordSource(nextManifest.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'manifestation',
        workArk: expression.workArk ?? undefined,
        expressionId: expression.id,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expression.id,
      },
    }
  }

  return state
}

function resolveClusterForWork(
  state: WorkspaceTabState,
  ctx: ShortcutContext,
  workArk: string | null,
  workId: string | null,
): Cluster | null {
  if (state.activeWorkAnchorId) {
    const match = ctx.clusters.find(cluster => cluster.anchorId === state.activeWorkAnchorId)
    if (match) return match
  }
  if (ctx.activeCluster) {
    return ctx.activeCluster
  }
  if (workId) {
    const byId = ctx.clusters.find(cluster => cluster.anchorId === workId)
    if (byId) return byId
  }
  if (workArk) {
    const byArk =
      ctx.clusters.find(cluster => cluster.anchorArk === workArk) ??
      ctx.clusters.find(cluster => cluster.items.some(item => item.ark === workArk))
    if (byArk) return byArk
  }
  return null
}

function resolveClusterForExpression(
  state: WorkspaceTabState,
  ctx: ShortcutContext,
  expressionId: string | null,
  expressionArk: string | null,
): Cluster | null {
  const candidate =
    resolveClusterForWork(state, ctx, state.highlightedWorkArk ?? null, state.activeWorkAnchorId) ?? ctx.activeCluster
  if (candidate && containsExpression(candidate, expressionId, expressionArk)) {
    return candidate
  }
  if (expressionId || expressionArk) {
    for (const cluster of ctx.clusters) {
      if (containsExpression(cluster, expressionId, expressionArk)) {
        return cluster
      }
    }
  }
  return null
}

function containsExpression(cluster: Cluster, expressionId: string | null, expressionArk: string | null): boolean {
  return !!findExpressionInCluster(cluster, expressionId ?? undefined, expressionArk ?? undefined)
}

function resolveAnchorExpressionId(cluster: Cluster, expression: ReturnType<typeof findExpressionInCluster>) {
  if (!expression) return null
  if ('anchorExpressionId' in expression && expression.anchorExpressionId) {
    return expression.anchorExpressionId
  }
  if (cluster.expressionGroups.some(group => group.anchor.id === expression.id)) {
    return expression.id
  }
  return null
}

function inferRecordSource(id: string | undefined, curated: RecordRow[], original: RecordRow[]): 'curated' | 'original' {
  if (id && curated.some(record => record.id === id)) return 'curated'
  if (id && original.some(record => record.id === id)) return 'original'
  return 'curated'
}

import { findExpressionInCluster, findPrimaryExpressionForWork } from '../core/entities'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace } from './types'
import type { WorkspaceDataIndexes } from './useWorkspaceData'

type ShortcutContext = {
  clusters: Cluster[]
  activeCluster: Cluster | null
  activeClusterSource: 'cluster' | 'inventory' | 'none'
  indexes: WorkspaceDataIndexes
  curatedRecords: RecordRow[]
}

export function focusTreeUp(state: WorkspaceTabStateWorkspace, ctx: ShortcutContext): WorkspaceTabStateWorkspace {
  const selected = state.selectedEntity
  if (!selected) return state

  const clusterResult = focusClusterTreeUp(state, selected, ctx)
  if (clusterResult) return clusterResult
  return state
}

export function focusTreeDown(state: WorkspaceTabStateWorkspace, ctx: ShortcutContext): WorkspaceTabStateWorkspace {
  const selected = state.selectedEntity
  if (!selected) return state

  const clusterResult = focusClusterTreeDown(state, selected, ctx)
  if (clusterResult) return clusterResult
  return state
}

function focusClusterTreeUp(
  state: WorkspaceTabStateWorkspace,
  entity: NonNullable<WorkspaceTabStateWorkspace['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabStateWorkspace | null {
  if (entity.entityType === 'manifestation') {
    const cluster = resolveClusterForExpression(state, ctx, entity.expressionId ?? null, entity.expressionArk ?? null)
    if (!cluster) return null
    const expression = findExpressionInCluster(cluster, entity.expressionId, entity.expressionArk)
    if (!expression) return null
    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionId = expression.id
    const expressionArk = expression.ark ?? entity.expressionArk ?? null
    const workArk = expression.workArk ?? cluster.anchorArk ?? null

    return {
      ...state,
      viewMode: 'expressions',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk,
      highlightedWorkId: cluster.anchorId,
      highlightedWorkArk: workArk ?? null,
      selectedEntity: {
        id: expressionId,
        source: inferRecordSource(expressionId, ctx.curatedRecords),
        entityType: 'expression',
        workArk: workArk ?? undefined,
        expressionId,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expressionId,
      },
    }
  }

  if (entity.entityType === 'expression') {
    const cluster = resolveClusterForExpression(state, ctx, entity.expressionId ?? null, entity.expressionArk ?? null)
    if (!cluster) return null
    const expression = findExpressionInCluster(cluster, entity.expressionId, entity.expressionArk)
    const workArk = expression?.workArk ?? entity.workArk ?? (entity.expressionArk ? cluster.anchorArk : null) ?? cluster.anchorArk
    const workId =
      (expression && 'workId' in expression && expression.workId) ||
      (workArk ? cluster.items.find(item => item.ark === workArk)?.id : undefined) ||
      cluster.anchorId

    return {
      ...state,
      viewMode: 'works',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkId: workId ?? cluster.anchorId,
      highlightedWorkArk: workArk ?? null,
      selectedEntity: {
        id: workId,
        source: inferRecordSource(workId, ctx.curatedRecords),
        entityType: 'work',
        workArk: workArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: workId === cluster.anchorId,
      },
    }
  }

  return null
}

function focusClusterTreeDown(
  state: WorkspaceTabStateWorkspace,
  entity: NonNullable<WorkspaceTabStateWorkspace['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabStateWorkspace | null {
  if (entity.entityType === 'work') {
    const workArk = entity.workArk ?? state.highlightedWorkArk ?? null
    const cluster = resolveClusterForWork(state, ctx, workArk, entity.id)
    if (!cluster) return null
    const targetWorkArk = workArk ?? cluster.anchorArk
    const expression = findPrimaryExpressionForWork(cluster, targetWorkArk)

    const baseState: WorkspaceTabStateWorkspace = {
      ...state,
      viewMode: 'expressions',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkId: cluster.anchorId,
      highlightedWorkArk: targetWorkArk ?? null,
    }

    if (!expression) {
      return baseState
    }

    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionArk = expression.ark ?? null

    return {
      ...baseState,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk,
      selectedEntity: {
        id: expression.id,
        source: inferRecordSource(expression.id, ctx.curatedRecords),
        entityType: 'expression',
        workArk: expression.workArk ?? targetWorkArk ?? undefined,
        expressionId: expression.id,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expression.id,
      },
    }
  }

  if (entity.entityType === 'expression') {
    const cluster = resolveClusterForExpression(state, ctx, entity.expressionId ?? null, entity.expressionArk ?? null)
    if (!cluster) return null
    const expression = findExpressionInCluster(cluster, entity.expressionId, entity.expressionArk)
    if (!expression) return null

    const anchorId = resolveAnchorExpressionId(cluster, expression)
    const expressionArk = expression.ark ?? entity.expressionArk ?? null
    const nextManifest = expression.manifestations[0]

    const baseState: WorkspaceTabStateWorkspace = {
      ...state,
      viewMode: 'manifestations',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk ?? null,
      highlightedWorkId: cluster.anchorId,
      highlightedWorkArk: expression.workArk ?? state.highlightedWorkArk ?? null,
    }

    if (!nextManifest) {
      return baseState
    }

    return {
      ...baseState,
      selectedEntity: {
        id: nextManifest.id,
        source: inferRecordSource(nextManifest.id, ctx.curatedRecords),
        entityType: 'manifestation',
        workArk: expression.workArk ?? undefined,
        expressionId: expression.id,
        expressionArk: expressionArk ?? undefined,
        clusterAnchorId: cluster.anchorId,
        isAnchor: !!anchorId && anchorId === expression.id,
      },
    }
  }

  return null
}

function resolveClusterForWork(
  state: WorkspaceTabStateWorkspace,
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
  state: WorkspaceTabStateWorkspace,
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

export function resolveAnchorExpressionId(cluster: Cluster, expression: ReturnType<typeof findExpressionInCluster>) {
  if (!expression) return null
  if ('anchorExpressionId' in expression && expression.anchorExpressionId) {
    return expression.anchorExpressionId
  }
  if (cluster.expressionGroups.some(group => group.anchor.id === expression.id)) {
    return expression.id
  }
  return null
}

export function inferRecordSource(id: string | undefined, curated: RecordRow[]): 'curated' {
  if (id && curated.some(record => record.id === id)) return 'curated'
  return 'curated'
}

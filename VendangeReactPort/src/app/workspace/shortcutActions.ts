import { findExpressionInCluster, findPrimaryExpressionForWork, titleOf, expressionWorkArks } from '../core/entities'
import { getCurrentLanguage } from '../i18n'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabState } from './types'
import type { WorkspaceDataIndexes } from './useWorkspaceData'

type ShortcutContext = {
  clusters: Cluster[]
  activeCluster: Cluster | null
  activeClusterSource: 'cluster' | 'inventory' | 'none'
  inventoryWork: RecordRow | null
  indexes: WorkspaceDataIndexes
  curatedRecords: RecordRow[]
  originalRecords: RecordRow[]
}

export function focusTreeUp(state: WorkspaceTabState, ctx: ShortcutContext): WorkspaceTabState {
  const selected = state.selectedEntity
  if (!selected) return state

  if (state.listScope === 'inventory') {
    const inventoryResult = focusInventoryTreeUp(state, selected, ctx)
    return inventoryResult ?? state
  }

  const clusterResult = focusClusterTreeUp(state, selected, ctx)
  if (clusterResult) return clusterResult

  const inventoryFallback = focusInventoryTreeUp(state, selected, ctx)
  return inventoryFallback ?? state
}

export function focusTreeDown(state: WorkspaceTabState, ctx: ShortcutContext): WorkspaceTabState {
  const selected = state.selectedEntity
  if (!selected) return state

  if (state.listScope === 'inventory') {
    const inventoryResult = focusInventoryTreeDown(state, selected, ctx)
    return inventoryResult ?? state
  }

  const clusterResult = focusClusterTreeDown(state, selected, ctx)
  if (clusterResult) return clusterResult

  const inventoryFallback = focusInventoryTreeDown(state, selected, ctx)
  return inventoryFallback ?? state
}

function focusClusterTreeUp(
  state: WorkspaceTabState,
  entity: NonNullable<WorkspaceTabState['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabState | null {
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
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusWorkId: null,
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
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: workId,
        source: inferRecordSource(workId, ctx.curatedRecords, ctx.originalRecords),
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
  state: WorkspaceTabState,
  entity: NonNullable<WorkspaceTabState['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabState | null {
  if (entity.entityType === 'work') {
    const workArk = entity.workArk ?? state.highlightedWorkArk ?? null
    const cluster = resolveClusterForWork(state, ctx, workArk, entity.id)
    if (!cluster) return null
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
      inventoryFocusWorkId: null,
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
        source: inferRecordSource(expression.id, ctx.curatedRecords, ctx.originalRecords),
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

    const baseState: WorkspaceTabState = {
      ...state,
      viewMode: 'manifestations',
      listScope: 'clusters',
      activeWorkAnchorId: cluster.anchorId,
      activeExpressionAnchorId: anchorId,
      highlightedExpressionArk: expressionArk ?? null,
      highlightedWorkArk: expression.workArk ?? state.highlightedWorkArk ?? null,
      inventoryFocusExpressionId: null,
      inventoryFocusWorkId: null,
    }

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

  return null
}

function focusInventoryTreeUp(
  state: WorkspaceTabState,
  entity: NonNullable<WorkspaceTabState['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabState | null {
  if (entity.entityType === 'manifestation') {
    const expressionRecord = findExpressionRecord(entity.expressionId, entity.expressionArk, ctx)
    if (!expressionRecord) return null
    const workArk = expressionWorkArks(expressionRecord)[0] ?? entity.workArk ?? null
    const workRecord = findWorkRecord(null, workArk ?? null, ctx)
    const expressionArk = expressionRecord.ark || entity.expressionArk || null

    return {
      ...state,
      listScope: 'inventory',
      viewMode: 'expressions',
      activeWorkAnchorId: null,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: expressionArk,
      highlightedWorkArk: workArk ?? state.highlightedWorkArk ?? null,
      inventoryFocusWorkId: workRecord?.id ?? state.inventoryFocusWorkId ?? null,
      inventoryFocusExpressionId: expressionRecord.id,
      selectedEntity: {
        id: expressionRecord.id,
        source: inferRecordSource(expressionRecord.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'expression',
        workArk: workArk ?? undefined,
        expressionId: expressionRecord.id,
        expressionArk: expressionArk ?? undefined,
      },
    }
  }

  if (entity.entityType === 'expression') {
    const expressionRecord = findExpressionRecord(entity.expressionId ?? entity.id, entity.expressionArk, ctx)
    const workArk = entity.workArk ?? (expressionRecord ? expressionWorkArks(expressionRecord)[0] : undefined) ?? null
    const workRecord = findWorkRecord(entity.id, workArk, ctx)
    const cluster = resolveClusterForWork(state, ctx, workArk, workRecord?.id ?? entity.id)

    return {
      ...state,
      listScope: 'clusters',
      viewMode: 'works',
      activeWorkAnchorId: cluster?.anchorId ?? null,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: workRecord?.id ?? entity.id,
        source: inferRecordSource(workRecord?.id ?? entity.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'work',
        workArk: workArk ?? undefined,
        clusterAnchorId: cluster?.anchorId,
        isAnchor: cluster ? (workRecord?.id ?? entity.id) === cluster.anchorId : false,
      },
    }
  }

  if (entity.entityType === 'work') {
    const workRecord = findWorkRecord(entity.id, entity.workArk ?? null, ctx)
    const cluster = resolveClusterForWork(state, ctx, workRecord?.ark ?? entity.workArk ?? null, workRecord?.id ?? entity.id)

    return {
      ...state,
      listScope: 'clusters',
      viewMode: 'works',
      activeWorkAnchorId: cluster?.anchorId ?? null,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: null,
      highlightedWorkArk: workRecord?.ark ?? entity.workArk ?? null,
      inventoryFocusWorkId: null,
      inventoryFocusExpressionId: null,
      selectedEntity: {
        id: workRecord?.id ?? entity.id,
        source: inferRecordSource(workRecord?.id ?? entity.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'work',
        workArk: workRecord?.ark ?? entity.workArk ?? undefined,
        clusterAnchorId: cluster?.anchorId,
        isAnchor: cluster ? (workRecord?.id ?? entity.id) === cluster.anchorId : false,
      },
    }
  }

  return null
}

function focusInventoryTreeDown(
  state: WorkspaceTabState,
  entity: NonNullable<WorkspaceTabState['selectedEntity']>,
  ctx: ShortcutContext,
): WorkspaceTabState | null {
  if (entity.entityType === 'work') {
    const workRecord = findWorkRecord(entity.id, entity.workArk ?? null, ctx)
    const workArk = workRecord?.ark ?? entity.workArk ?? null
    const expressions = workArk ? [...(ctx.indexes.expressionsByWorkArk.get(workArk) ?? [])] : []

    if (!expressions.length) {
      return {
        ...state,
        listScope: 'inventory',
        viewMode: 'expressions',
        activeWorkAnchorId: null,
        activeExpressionAnchorId: null,
        highlightedExpressionArk: null,
        highlightedWorkArk: workArk ?? null,
        inventoryFocusWorkId: workRecord?.id ?? entity.id,
        inventoryFocusExpressionId: null,
        selectedEntity: {
          id: entity.id,
          source: inferRecordSource(entity.id, ctx.curatedRecords, ctx.originalRecords),
          entityType: 'work',
          workArk: workArk ?? undefined,
        },
      }
    }

    const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
    expressions.sort((a, b) => collator.compare(getExpressionLabel(a), getExpressionLabel(b)))
    const first = expressions[0]
    const expressionArk = first.ark || null

    return {
      ...state,
      listScope: 'inventory',
      viewMode: 'expressions',
      activeWorkAnchorId: null,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: expressionArk,
      highlightedWorkArk: workArk ?? null,
      inventoryFocusWorkId: workRecord?.id ?? entity.id,
      inventoryFocusExpressionId: first.id,
      selectedEntity: {
        id: first.id,
        source: inferRecordSource(first.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'expression',
        workArk: workArk ?? undefined,
        expressionId: first.id,
        expressionArk: expressionArk ?? undefined,
      },
    }
  }

  if (entity.entityType === 'expression') {
    const expressionRecord = findExpressionRecord(entity.expressionId ?? entity.id, entity.expressionArk, ctx)
    const expressionArk = expressionRecord?.ark ?? entity.expressionArk ?? null
    const workArk = entity.workArk ?? (expressionRecord ? expressionWorkArks(expressionRecord)[0] : undefined) ?? null
    const manifestations = expressionArk ? [...(ctx.indexes.manifestationsByExpressionArk.get(expressionArk) ?? [])] : []

    if (!manifestations.length) {
      return {
        ...state,
        listScope: 'inventory',
        viewMode: 'manifestations',
        activeWorkAnchorId: null,
        activeExpressionAnchorId: null,
        highlightedExpressionArk: expressionArk,
        highlightedWorkArk: workArk ?? state.highlightedWorkArk ?? null,
        inventoryFocusExpressionId: entity.expressionId ?? entity.id,
        inventoryFocusWorkId: state.inventoryFocusWorkId ?? null,
        selectedEntity: {
          ...entity,
          expressionId: entity.expressionId ?? entity.id,
          expressionArk: expressionArk ?? undefined,
          workArk: workArk ?? entity.workArk,
        },
      }
    }

    const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
    manifestations.sort((a, b) => collator.compare(getManifestationLabel(a), getManifestationLabel(b)))
    const first = manifestations[0]

    return {
      ...state,
      listScope: 'inventory',
      viewMode: 'manifestations',
      activeWorkAnchorId: null,
      activeExpressionAnchorId: null,
      highlightedExpressionArk: expressionArk,
      highlightedWorkArk: workArk ?? state.highlightedWorkArk ?? null,
      inventoryFocusExpressionId: entity.expressionId ?? entity.id,
      inventoryFocusWorkId: state.inventoryFocusWorkId ?? null,
      selectedEntity: {
        id: first.id,
        source: inferRecordSource(first.id, ctx.curatedRecords, ctx.originalRecords),
        entityType: 'manifestation',
        expressionId: expressionRecord?.id,
        expressionArk: expressionArk ?? undefined,
        workArk: workArk ?? undefined,
      },
    }
  }

  return null
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

function findWorkRecord(
  workId: string | null | undefined,
  workArk: string | null | undefined,
  ctx: ShortcutContext,
): RecordRow | null {
  if (workId) {
    const byId = ctx.indexes.worksById.get(workId)
    if (byId) return byId
  }
  if (workArk) {
    const byArk = ctx.indexes.worksByArk.get(workArk)
    if (byArk) return byArk
  }
  return null
}

function findExpressionRecord(
  expressionId: string | null | undefined,
  expressionArk: string | null | undefined,
  ctx: ShortcutContext,
): RecordRow | null {
  if (expressionId) {
    const byId = ctx.indexes.expressionsById.get(expressionId)
    if (byId) return byId
  }
  if (expressionArk) {
    const byArk = ctx.indexes.expressionsByArk.get(expressionArk)
    if (byArk) return byArk
  }
  return null
}

function getExpressionLabel(record: RecordRow): string {
  return titleOf(record) || record.id
}

function getManifestationLabel(record: RecordRow): string {
  return titleOf(record) || record.id
}

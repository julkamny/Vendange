import type {
  Cluster,
  WorkClusterDto,
  WorkClusterItemDto,
  ExpressionItemViewDto,
  ExpressionClusterItemViewDto,
  ManifestationItemViewDto,
} from '../types'

function mapManifestation(view: ManifestationItemViewDto): import('../types').ManifestationItem {
  return {
    id: view.id,
    ark: view.ark || view.id,
    title: view.title || view.id,
    titleSegments: view.title_segments ?? undefined,
    expressionArk: view.expression_ark || view.original_expression_ark || '',
    expressionId: view.expression_id || undefined,
    originalExpressionArk: view.original_expression_ark || view.expression_ark || '',
    summary: view.summary ?? null,
  }
}

function mapExpression(view: ExpressionItemViewDto): import('../types').ExpressionItem {
  const manifestations = (view.manifestations || []).map(mapManifestation)
  return {
    id: view.id,
    ark: view.ark || view.id,
    title: view.title || view.id,
    titleSegments: view.title_segments ?? undefined,
    workArk: view.work_ark || '',
    workId: view.work_id || undefined,
    manifestations,
    summary: view.summary ?? null,
  }
}

function mapExpressionCluster(view: ExpressionClusterItemViewDto): import('../types').ExpressionClusterItem {
  const base = mapExpression(view)
  return {
    ...base,
    anchorExpressionId: view.anchor_expression_id,
    accepted: view.accepted,
    date: view.date || undefined,
    origin: view.origin,
    summary: view.summary ?? base.summary ?? null,
  }
}

function mapClusterItem(view: WorkClusterItemDto): import('../types').ClusterItem {
  return {
    ark: view.ark,
    id: view.id || undefined,
    title: view.title || view.id || view.ark,
    titleSegments: view.title_segments ?? undefined,
    accepted: view.accepted,
    date: view.date || undefined,
    origin: view.origin,
    summary: view.summary ?? null,
  }
}

export function mapWorkCluster(dto: WorkClusterDto): Cluster {
  const expressionGroups = (dto.expression_groups || []).map(group => ({
    anchor: mapExpression(group.anchor),
    clustered: (group.clustered || []).map(mapExpressionCluster),
  }))
  const independentExpressions = (dto.independent_expressions || []).map(mapExpression)
  const anchorSummary = dto.anchor_summary ?? null
  return {
    anchorId: dto.anchor_id,
    anchorArk: dto.anchor_ark || '',
    anchorTitle: dto.anchor_title || dto.anchor_id,
    anchorTitleSegments: dto.anchor_title_segments ?? undefined,
    anchor_summary: anchorSummary,
    anchorSummary,
    items: (dto.items || []).map(mapClusterItem),
    expressionGroups,
    independentExpressions,
  }
}

export function mapWorkClusters(dtos: WorkClusterDto[] | undefined | null): Cluster[] {
  if (!dtos) return []
  return dtos.map(mapWorkCluster)
}

import type { Cluster, ExpressionClusterItem, ExpressionItem, ManifestationItem, RecordRow } from '../types'
import { manifestationExpressionArks } from './entities'

export type ClusterCoverage = {
  workIds: Set<string>
  workArks: Set<string>
  expressionIds: Set<string>
  expressionArks: Set<string>
  manifestationIds: Set<string>
  manifestationArks: Set<string>
  manifestationsByExpressionArk: Map<string, Set<string>>
}

export function computeClusterCoverage(clusters: Cluster[]): ClusterCoverage {
  const coverage: ClusterCoverage = {
    workIds: new Set(),
    workArks: new Set(),
    expressionIds: new Set(),
    expressionArks: new Set(),
    manifestationIds: new Set(),
    manifestationArks: new Set(),
    manifestationsByExpressionArk: new Map(),
  }

  const registerManifestation = (item: ManifestationItem) => {
    coverage.manifestationIds.add(item.id)
    if (item.ark) coverage.manifestationArks.add(item.ark)
    if (item.expressionArk) {
      if (!coverage.manifestationsByExpressionArk.has(item.expressionArk)) {
        coverage.manifestationsByExpressionArk.set(item.expressionArk, new Set())
      }
      coverage.manifestationsByExpressionArk.get(item.expressionArk)!.add(item.id)
    }
  }

  const registerExpression = (item: ExpressionItem | ExpressionClusterItem) => {
    coverage.expressionIds.add(item.id)
    if (item.ark) coverage.expressionArks.add(item.ark)
    item.manifestations.forEach(registerManifestation)
  }

  for (const cluster of clusters) {
    coverage.workIds.add(cluster.anchorId)
    if (cluster.anchorArk) coverage.workArks.add(cluster.anchorArk)
    cluster.items.forEach(item => {
      if (item.id) coverage.workIds.add(item.id)
      if (item.ark) coverage.workArks.add(item.ark)
    })
    for (const group of cluster.expressionGroups) {
      registerExpression(group.anchor)
      group.clustered.forEach(registerExpression)
    }
    cluster.independentExpressions.forEach(registerExpression)
  }

  return coverage
}

export function isWorkClustered(rec: RecordRow, coverage: ClusterCoverage): boolean {
  if (coverage.workIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && coverage.workArks.has(ark)) return true
  return false
}

export function isExpressionClustered(rec: RecordRow, coverage: ClusterCoverage): boolean {
  if (coverage.expressionIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && coverage.expressionArks.has(ark)) return true
  return false
}

export function isManifestationClustered(
  rec: RecordRow,
  coverage: ClusterCoverage,
): boolean {
  const expressionArks = manifestationExpressionArks(rec)
  if (expressionArks.length) {
    const uncovered = expressionArks.some(exprArk => {
      const ids = coverage.manifestationsByExpressionArk.get(exprArk)
      return !ids || !ids.has(rec.id)
    })
    if (uncovered) return false
  }
  if (coverage.manifestationIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && coverage.manifestationArks.has(ark)) return true
  return false
}

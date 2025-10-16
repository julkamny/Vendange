import type { Cluster, ExpressionClusterItem, ExpressionItem, RecordRow } from '../types'
import type { OriginalIndexes } from './originalIndexes'

export function computeWorkCounts(cluster: Cluster, workArk?: string | null): {
  expressions: number
  manifestations: number
} {
  if (!workArk) return { expressions: 0, manifestations: 0 }
  let expressions = 0
  let manifestations = 0
  const consider = (expression: ExpressionItem | ExpressionClusterItem) => {
    if (expression.workArk !== workArk) return
    expressions += 1
    manifestations += expression.manifestations.length
  }
  for (const group of cluster.expressionGroups) {
    consider(group.anchor)
    for (const expr of group.clustered) consider(expr)
  }
  for (const expr of cluster.independentExpressions) consider(expr)
  return { expressions, manifestations }
}

export function computeUnclusteredWorkCounts(
  work: RecordRow,
  indexes: OriginalIndexes | null,
): { expressions: number; manifestations: number } {
  if (!indexes) return { expressions: 0, manifestations: 0 }
  const workArk = work.ark
  if (!workArk) return { expressions: 0, manifestations: 0 }
  const expressions = indexes.expressionsByWorkArk.get(workArk) ?? []
  let manifestationCount = 0
  for (const expr of expressions) {
    if (!expr.ark) continue
    manifestationCount += indexes.manifestationsByExpressionArk.get(expr.ark)?.length ?? 0
  }
  return { expressions: expressions.length, manifestations: manifestationCount }
}


import { findZones } from '../lib/intermarc'
import type { Cluster, ExpressionItem, ExpressionClusterItem, ManifestationItem, RecordRow } from '../types'

export function zoneText(zone: { sousZones: Array<{ valeur?: unknown }> }): string {
  const parts = zone.sousZones
    .map(sz => (sz.valeur ? String(sz.valeur).trim() : ''))
    .filter(part => part.length > 0)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function titleOf(rec: RecordRow): string | undefined {
  const zone = findZones(rec.intermarc, '150')[0]
  const text = zone ? zoneText(zone) : undefined
  return text && text.length ? text : undefined
}

export function expressionWorkArks(rec: RecordRow): string[] {
  return findZones(rec.intermarc, '750')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '750$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
}

export function expressionClusterTargets(rec: RecordRow): { ark: string; date: string | undefined }[] {
  return findZones(rec.intermarc, '750')
    .map(z => {
      const ark = z.sousZones.find(sz => sz.code === '750$3')?.valeur
      if (!ark) return null
      const date = z.sousZones.find(sz => sz.code === '750$d')?.valeur
      return { ark, date }
    })
    .filter((v): v is { ark: string; date: string | undefined } => !!v)
}

export function manifestationExpressionArks(rec: RecordRow): string[] {
  return findZones(rec.intermarc, '740')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '740$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
}

export function manifestationTitle(rec: RecordRow): string | undefined {
  const zone = findZones(rec.intermarc, '245')[0]
  const text = zone ? zoneText(zone) : undefined
  return text && text.length ? text : undefined
}

export function manifestationsForExpression(
  expressionArk: string,
  manifestMap: Map<string, RecordRow[]>,
  expressionsByArk: Map<string, RecordRow>,
): ManifestationItem[] {
  const recs = manifestMap.get(expressionArk) || []
  const expressionId = expressionsByArk.get(expressionArk)?.id
  return recs.map(rec => ({
    id: rec.id,
    ark: rec.ark || rec.id,
    title: manifestationTitle(rec) || rec.id,
    expressionArk,
    expressionId,
    originalExpressionArk: expressionArk,
  }))
}

export function findExpressionInCluster(
  cluster: Cluster,
  expressionId?: string | null,
  expressionArk?: string | null,
): ExpressionItem | ExpressionClusterItem | undefined {
  if (!expressionId && !expressionArk) return undefined
  for (const group of cluster.expressionGroups) {
    if (expressionId && group.anchor.id === expressionId) return group.anchor
    if (expressionArk && group.anchor.ark === expressionArk) return group.anchor
    for (const expr of group.clustered) {
      if (expressionId && expr.id === expressionId) return expr
      if (expressionArk && expr.ark === expressionArk) return expr
    }
  }
  for (const expr of cluster.independentExpressions) {
    if (expressionId && expr.id === expressionId) return expr
    if (expressionArk && expr.ark === expressionArk) return expr
  }
  return undefined
}

export function findPrimaryExpressionForWork(
  cluster: Cluster,
  workArk: string | undefined,
): ExpressionItem | ExpressionClusterItem | undefined {
  if (!workArk) return undefined
  const groups = cluster.expressionGroups
  if (workArk === cluster.anchorArk) {
    if (groups.length) return groups[0].anchor
  }
  for (const group of groups) {
    if (group.anchor.workArk === workArk) return group.anchor
    const clusteredMatch = group.clustered.find(expr => expr.workArk === workArk)
    if (clusteredMatch) return clusteredMatch
  }
  return cluster.independentExpressions.find(expr => expr.workArk === workArk)
}

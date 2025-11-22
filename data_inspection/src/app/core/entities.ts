import { findZones } from '../lib/intermarc'
import { CLUSTER_NOTE } from './constants'
import type { EntityTitleSegment, Cluster, ExpressionItem, ExpressionClusterItem, ManifestationItem, RecordRow } from '../types'

export function zoneText(zone: { sousZones: Array<{ valeur?: unknown }> }): string {
  const parts = zone.sousZones
    .map(sz => (sz.valeur ? String(sz.valeur).trim() : ''))
    .filter(part => part.length > 0)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractSubfieldLabel(code: string): string {
  const trimmed = code?.trim() ?? ''
  if (!trimmed) return ''
  const dollarIndex = trimmed.lastIndexOf('$')
  if (dollarIndex >= 0 && dollarIndex + 1 < trimmed.length) {
    return trimmed.slice(dollarIndex + 1)
  }
  if (trimmed.startsWith('150')) {
    return trimmed.slice(3)
  }
  return trimmed
}

export function titleOf(rec: RecordRow): string | undefined {
  const zone = findZones(rec.intermarc, '150')[0]
  const text = zone ? zoneText(zone) : undefined
  return text && text.length ? text : undefined
}

export function workTitleSegments(rec: RecordRow): EntityTitleSegment[] {
  const zone = findZones(rec.intermarc, '150')[0]
  if (!zone) return []
  const segments: EntityTitleSegment[] = []
  for (const sz of zone.sousZones) {
    const value = typeof sz.valeur === 'string' ? sz.valeur.trim() : ''
    if (!value) continue
    const labelSource = extractSubfieldLabel(sz.code)
    const label = labelSource ? labelSource.toUpperCase() : sz.code
    segments.push({ code: sz.code, label, value })
  }
  return segments
}

export function manifestationTitleSegments(rec: RecordRow): EntityTitleSegment[] {
  const zone = findZones(rec.intermarc, '245')[0]
  if (!zone) return []
  const segments: EntityTitleSegment[] = []
  for (const sz of zone.sousZones) {
    const value = typeof sz.valeur === 'string' ? sz.valeur.trim() : ''
    if (!value) continue
    const labelSource = extractSubfieldLabel(sz.code)
    const label = labelSource ? labelSource.toUpperCase() : sz.code
    segments.push({ code: sz.code, label, value })
  }
  return segments
}

export function expression140Segments(
  rec: RecordRow,
  options: { lookupWorkByArk?: (ark: string) => RecordRow | undefined } = {},
): EntityTitleSegment[] {
  const zone = findZones(rec.intermarc, '140')[0]
  if (!zone) return []
  const segments: EntityTitleSegment[] = []
  for (const sz of zone.sousZones) {
    let value = typeof sz.valeur === 'string' ? sz.valeur.trim() : ''
    if (!value) continue
    if (sz.code === '140$3' && options.lookupWorkByArk) {
      const workRecord = options.lookupWorkByArk(value)
      if (workRecord) {
        value = titleOf(workRecord) || workRecord.id || value
      }
    }
    const labelSource = extractSubfieldLabel(sz.code)
    const label = labelSource ? labelSource.toUpperCase() : sz.code
    segments.push({ code: sz.code, label, value })
  }
  return segments
}

export function expressionWorkArks(rec: RecordRow): string[] {
  const from140 = findZones(rec.intermarc, '140')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '140$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
  if (from140.length) return from140
  return findZones(rec.intermarc, '750')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '750$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
}

export function expressionClusterTargets(rec: RecordRow): { ark: string; date: string | undefined }[] {
  return findZones(rec.intermarc, '90F')
    .filter(z => z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === CLUSTER_NOTE))
    .map(z => {
      const ark = z.sousZones.find(sz => sz.code === '90F$a')?.valeur
      if (!ark) return null
      const date = z.sousZones.find(sz => sz.code === '90F$d')?.valeur
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

export function countExpressionWorkLinks(rec: RecordRow): number {
  if (rec.typeNorm !== 'expression') return 0
  const zones = findZones(rec.intermarc, '750')
  const arks = new Set<string>()
  zones.forEach(zone => {
    zone.sousZones.forEach(sub => {
      if (sub.code !== '750$3') return
      const value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
      if (!value) return
      arks.add(value)
    })
  })
  return arks.size
}

export function agentTitleSegments(rec: RecordRow): EntityTitleSegment[] {
  const norm = rec.typeNorm.toLowerCase()
  const zoneCode = norm === 'collectivite' ? '110' : norm === 'famille' ? '120' : '100'
  const zone = findZones(rec.intermarc, zoneCode)[0]
  if (!zone) return []
  const segments: EntityTitleSegment[] = []
  for (const sz of zone.sousZones) {
    const value = typeof sz.valeur === 'string' ? sz.valeur.trim() : ''
    if (!value) continue
    // Only keep lowercase subfield codes (case-sensitive)
    const code = sz.code ?? ''
    const dollarIndex = code.lastIndexOf('$')
    const sub = dollarIndex >= 0 ? code.slice(dollarIndex + 1) : code
    if (sub !== sub.toLowerCase()) continue
    const labelSource = extractSubfieldLabel(sz.code)
    const label = labelSource ? labelSource.toUpperCase() : sz.code
    segments.push({ code: sz.code, label, value })
  }
  return segments
}

export function countManifestationExpressionLinks(rec: RecordRow): number {
  if (rec.typeNorm !== 'manifestation') return 0
  const zones = findZones(rec.intermarc, '740')
  const arks = new Set<string>()
  zones.forEach(zone => {
    zone.sousZones.forEach(sub => {
      if (sub.code !== '740$3') return
      const value = typeof sub.valeur === 'string' ? sub.valeur.trim() : ''
      if (!value) return
      arks.add(value)
    })
  })
  return arks.size
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

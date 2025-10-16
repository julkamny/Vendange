import { findZones } from '../lib/intermarc'
import type { Cluster, ClusterItem, ExpressionAnchorGroup, ExpressionClusterItem, ExpressionItem, RecordRow } from '../types'
import { CLUSTER_NOTE } from './constants'
import {
  titleOf,
  expressionWorkArks,
  expressionClusterTargets,
  manifestationExpressionArks,
  manifestationsForExpression,
} from './entities'

export function detectClusters(curated: RecordRow[], originalIdxByArk: Map<string, RecordRow>): Cluster[] {
  const worksByArk = new Map<string, RecordRow>()
  const workIdByArk = new Map<string, string>()
  const workTitleByArk = new Map<string, string>()
  const expressionsByArk = new Map<string, RecordRow>()
  const expressionsByWorkArk = new Map<string, RecordRow[]>()
  const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

  for (const rec of curated) {
    if (rec.typeNorm === 'oeuvre') {
      const workArk = rec.ark
      if (workArk) {
        worksByArk.set(workArk, rec)
        workIdByArk.set(workArk, rec.id)
        workTitleByArk.set(workArk, titleOf(rec) || rec.id)
      }
    } else if (rec.typeNorm === 'expression') {
      if (rec.ark) expressionsByArk.set(rec.ark, rec)
      const workArks = expressionWorkArks(rec)
      for (const workArk of workArks) {
        if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
        expressionsByWorkArk.get(workArk)!.push(rec)
      }
    } else if (rec.typeNorm === 'manifestation') {
      for (const exprArk of manifestationExpressionArks(rec)) {
        if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
        manifestationsByExpressionArk.get(exprArk)!.push(rec)
      }
    }
  }

  const result: Cluster[] = []
  for (const work of curated) {
    if (work.typeNorm !== 'oeuvre') continue

    const zones = findZones(work.intermarc, '90F')
    const items: ClusterItem[] = []
    for (const z of zones) {
      const note = z.sousZones.find(sz => sz.code === '90F$q')?.valeur
      if (note !== CLUSTER_NOTE) continue
      const ark = z.sousZones.find(sz => sz.code === '90F$a')?.valeur
      if (!ark) continue
      const date = z.sousZones.find(sz => sz.code === '90F$d')?.valeur
      const curatedTarget = worksByArk.get(ark)
      const fallback = curatedTarget || originalIdxByArk.get(ark)
      const title = curatedTarget
        ? titleOf(curatedTarget)
        : fallback?.intermarc?.zones
            .filter(zz => zz.code === '150')
            .flatMap(zz => zz.sousZones)
            .find(sz => sz.code === '150$a')?.valeur
      const id = curatedTarget?.id || fallback?.id
      items.push({ ark, id, title, accepted: true, date })
    }
    if (!items.length) continue

    const anchorArk = work.ark || ''
    const anchorTitle = titleOf(work)

    const anchorExpressions = expressionsByWorkArk.get(anchorArk) || []
    const expressionGroups: ExpressionAnchorGroup[] = []
    const usedExpressionArks = new Set<string>()

    for (const expr of anchorExpressions) {
      const anchorManifestations = expr.ark
        ? manifestationsForExpression(expr.ark, manifestationsByExpressionArk, expressionsByArk)
        : []
      const anchorExpression: ExpressionItem = {
        id: expr.id,
        ark: expr.ark || expr.id,
        title: titleOf(expr) || expr.id,
        workArk: anchorArk,
        workId: work.id,
        manifestations: anchorManifestations,
      }

      const clustered: ExpressionClusterItem[] = []
      for (const { ark: targetArk, date } of expressionClusterTargets(expr)) {
        const target = expressionsByArk.get(targetArk)
        const workArks = target ? expressionWorkArks(target) : []
        const sourceWorkArk = workArks[0] || ''
        const sourceWorkId = sourceWorkArk ? workIdByArk.get(sourceWorkArk) : undefined
        const targetManifestations = manifestationsForExpression(
          targetArk,
          manifestationsByExpressionArk,
          expressionsByArk,
        )
        clustered.push({
          id: target?.id || targetArk,
          ark: targetArk,
          title: target ? titleOf(target) || target.id : targetArk,
          workArk: sourceWorkArk,
          workId: sourceWorkId,
          anchorExpressionId: expr.id,
          accepted: true,
          date,
          manifestations: targetManifestations,
        })
        usedExpressionArks.add(targetArk)
      }

      expressionGroups.push({ anchor: anchorExpression, clustered })
    }

    const independentExpressions: ExpressionItem[] = []
    for (const item of items) {
      const workExpressions = expressionsByWorkArk.get(item.ark) || []
      for (const expr of workExpressions) {
        const exprArk = expr.ark
        if (!exprArk || usedExpressionArks.has(exprArk)) continue
        const manifests = manifestationsForExpression(exprArk, manifestationsByExpressionArk, expressionsByArk)
        independentExpressions.push({
          id: expr.id,
          ark: exprArk,
          title: titleOf(expr) || expr.id,
          workArk: item.ark,
          workId: item.id,
          manifestations: manifests,
        })
        usedExpressionArks.add(exprArk)
      }
    }

    result.push({
      anchorId: work.id,
      anchorArk,
      anchorTitle,
      items,
      expressionGroups,
      independentExpressions,
    })
  }
  return result
}

export function buildArkIndex(records: RecordRow[]): Map<string, RecordRow> {
  const idx = new Map<string, RecordRow>()
  for (const r of records) {
    if (r.ark) idx.set(r.ark, r)
    const zones001 = findZones(r.intermarc, '001')
    for (const z of zones001) {
      const ark = z.sousZones.find(sz => sz.code === '001$a')?.valeur
      if (ark) idx.set(ark, r)
    }
  }
  return idx
}

import { findZones } from '../lib/intermarc'
import type { Cluster, ClusterItem, ExpressionAnchorGroup, ExpressionClusterItem, ExpressionItem, RecordRow } from '../types'
import { CLUSTER_NOTE, MANUAL_CLUSTER_NOTE } from './constants'
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
  const clusteredWorkArks = new Set<string>()

  for (const rec of curated) {
    if (rec.typeNorm === 'oeuvre') {
      const workArk = rec.ark
      if (workArk) {
        worksByArk.set(workArk, rec)
        workIdByArk.set(workArk, rec.id)
        workTitleByArk.set(workArk, titleOf(rec) || rec.id)
      }

      // Collect works that are clustered by another anchor to avoid duplicate clusters later.
      const zones = findZones(rec.intermarc, '90F')
      for (const z of zones) {
        const note = z.sousZones.find(sz => sz.code === '90F$q')?.valeur
        if (!note || (note !== CLUSTER_NOTE && note !== MANUAL_CLUSTER_NOTE)) continue
        const target = z.sousZones.find(sz => sz.code === '90F$3')?.valeur
        if (target) clusteredWorkArks.add(target)
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
    const seenTargets = new Set<string>()
    for (const z of zones) {
      const note = z.sousZones.find(sz => sz.code === '90F$q')?.valeur
      const origin = note === CLUSTER_NOTE ? 'script' : note === MANUAL_CLUSTER_NOTE ? 'manual' : null
      if (!origin) continue
      const ark = z.sousZones.find(sz => sz.code === '90F$3')?.valeur
      if (!ark || seenTargets.has(ark)) continue
      seenTargets.add(ark)
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
      items.push({ ark, id, title, accepted: true, date, origin })
    }

    const anchorArk = work.ark || ''
    const anchorTitle = titleOf(work)

    const isClusterMemberOnly = anchorArk && clusteredWorkArks.has(anchorArk)
    // Skip work that is only a clustered member (no outgoing 90F) to avoid duplicate cluster entries.
    if (!items.length && isClusterMemberOnly) continue

    const clusterWorkArks = [anchorArk, ...items.map(item => item.ark)]
    const candidateExpressions: RecordRow[] = []
    const seenCandidateIds = new Set<string>()
    for (const workArk of clusterWorkArks) {
      const expressions = expressionsByWorkArk.get(workArk) || []
      for (const expr of expressions) {
        if (seenCandidateIds.has(expr.id)) continue
        seenCandidateIds.add(expr.id)
        candidateExpressions.push(expr)
      }
    }

    const clusteredBy = new Map<string, string>()
    for (const expr of candidateExpressions) {
      for (const { ark: targetArk } of expressionClusterTargets(expr)) {
        if (!targetArk || clusteredBy.has(targetArk)) continue
        clusteredBy.set(targetArk, expr.id)
      }
    }

    const expressionGroups: ExpressionAnchorGroup[] = []
    const usedExpressionArks = new Set<string>()

    for (const expr of candidateExpressions) {
      const exprWorkArks = expressionWorkArks(expr)
      const exprWorkArk = exprWorkArks[0] || ''
      const anchorManifestations = expr.ark
        ? manifestationsForExpression(expr.ark, manifestationsByExpressionArk, expressionsByArk)
        : []
      const clusterTargets = expressionClusterTargets(expr)
      const isClusteredByAnother =
        expr.ark && clusteredBy.has(expr.ark) && clusteredBy.get(expr.ark) !== expr.id
      const shouldBeAnchor = clusterTargets.length > 0 || exprWorkArk === anchorArk

      if (!shouldBeAnchor || isClusteredByAnother) continue

      const anchorExpression: ExpressionItem = {
        id: expr.id,
        ark: expr.ark || expr.id,
        title: titleOf(expr) || expr.id,
        workArk: exprWorkArk,
        workId: exprWorkArk ? workIdByArk.get(exprWorkArk) : undefined,
        manifestations: anchorManifestations,
      }

      const clustered: ExpressionClusterItem[] = []
      for (const { ark: targetArk, date } of clusterTargets) {
        const target = expressionsByArk.get(targetArk)
        const workArks = target ? expressionWorkArks(target) : []
        const sourceWorkArk = workArks[0] || ''
        const sourceWorkId = sourceWorkArk ? workIdByArk.get(sourceWorkArk) : undefined
        const targetManifestations = manifestationsForExpression(
          targetArk,
          manifestationsByExpressionArk,
          expressionsByArk,
        )
        const origin =
          (() => {
            const zones = findZones(expr.intermarc, '90F')
            for (const z of zones) {
              const targetMatch = z.sousZones.some(
          sz => (sz.code === '90F$3') && sz.valeur === targetArk,
              )
              if (!targetMatch) continue
              const note = z.sousZones.find(sz => sz.code === '90F$q')?.valeur
              if (note === MANUAL_CLUSTER_NOTE) return 'manual'
              if (note === CLUSTER_NOTE) return 'script'
            }
            return 'script'
          })()

        clustered.push({
          id: target?.id || targetArk,
          ark: targetArk,
          title: target ? titleOf(target) || target.id : targetArk,
          workArk: sourceWorkArk,
          workId: sourceWorkId,
          anchorExpressionId: expr.id,
          accepted: true,
          date,
          origin,
          manifestations: targetManifestations,
        })
        usedExpressionArks.add(targetArk)
      }

      usedExpressionArks.add(anchorExpression.ark)
      expressionGroups.push({ anchor: anchorExpression, clustered })
    }

    const independentExpressions: ExpressionItem[] = []
    for (const expr of candidateExpressions) {
      const exprArk = expr.ark
      if (!exprArk || usedExpressionArks.has(exprArk)) continue
      if (clusteredBy.has(exprArk) && clusteredBy.get(exprArk) !== expr.id) continue
      const workArks = expressionWorkArks(expr)
      const workArk = workArks[0] || ''
      const workId = workArk ? workIdByArk.get(workArk) : undefined
      const manifests = manifestationsForExpression(exprArk, manifestationsByExpressionArk, expressionsByArk)
      independentExpressions.push({
        id: expr.id,
        ark: exprArk,
        title: titleOf(expr) || expr.id,
        workArk,
        workId,
        manifestations: manifests,
      })
      usedExpressionArks.add(exprArk)
    }
    const hasExpressionCluster =
      expressionGroups.some(group => group.clustered.length > 0) || independentExpressions.length > 0
    if (!items.length && !hasExpressionCluster) continue

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

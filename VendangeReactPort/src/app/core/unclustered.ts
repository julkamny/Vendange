import type { RecordRow } from '../types'
import { computeClusterCoverage, isWorkClustered, type ClusterCoverage } from './clusterCoverage'
import { titleOf } from './entities'

export function computeClusterCoverageForRecords(clusters: Parameters<typeof computeClusterCoverage>[0]): ClusterCoverage {
  return computeClusterCoverage(clusters)
}

export function getUnclusteredWorks(
  originalRecords: RecordRow[],
  coverage: ClusterCoverage,
  locale: string,
): RecordRow[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'accent' })
  return originalRecords
    .filter(rec => rec.typeNorm === 'oeuvre' && !isWorkClustered(rec, coverage))
    .sort((a, b) => collator.compare(titleOf(a) || a.id, titleOf(b) || b.id))
}

export function isClusterWorkAccepted(clusterItems: Array<{ ark: string; accepted: boolean }>, workArk?: string): boolean {
  if (!workArk) return true
  const target = clusterItems.find(item => item.ark === workArk)
  if (!target) return true
  return target.accepted
}

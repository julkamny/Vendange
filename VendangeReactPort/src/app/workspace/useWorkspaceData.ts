import { useMemo } from 'react'
import { useAppData } from '../providers/AppDataContext'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { getUnclusteredWorks } from '../core/unclustered'
import { useTranslation } from '../hooks/useTranslation'
import type { WorkspaceTabState } from './types'

export function useWorkspaceData(state: WorkspaceTabState) {
  const { clusters, original } = useAppData()
  const { language } = useTranslation()

  const coverage = useMemo(() => computeClusterCoverage(clusters), [clusters])
  const unclusteredWorks = useMemo(() => {
    if (!original) return []
    return getUnclusteredWorks(original.records, coverage, language)
  }, [original, coverage, language])

  const activeCluster = useMemo(() => {
    if (!state.activeWorkAnchorId) return clusters[0] ?? null
    return clusters.find(cluster => cluster.anchorId === state.activeWorkAnchorId) ?? null
  }, [clusters, state.activeWorkAnchorId])

  return {
    clusters,
    unclusteredWorks,
    coverage,
    activeCluster,
  }
}

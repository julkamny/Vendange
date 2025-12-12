import { useMemo } from 'react'
import { isExpressionClustered, isManifestationClustered, isWorkClustered } from '../../core/clusterCoverage'
import type { RecordRow, Cluster } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../../workspace/types'

type Params = {
  state: WorkspaceTabStateWorkspace
  record: RecordRow | null
  workspace: {
    clusters: Cluster[]
    coverage: unknown
  }
  t: (key: string, opts?: Record<string, unknown>) => string
}

export function useSelectionMeta({ state, record, workspace, t }: Params) {

  const isAnchorSelection = useMemo(() => {
    const selected = state.selectedEntity
    if (!selected) return false

    if (selected.entityType === 'work') {
      const targetArk = selected.workArk ?? record?.ark ?? null
      return workspace.clusters.some(cluster => cluster.anchorId === selected.id || (targetArk && cluster.anchorArk === targetArk))
    }

    if (selected.entityType === 'expression') {
      const targetId = selected.expressionId ?? selected.id
      const targetArk = selected.expressionArk ?? record?.ark ?? null
      return workspace.clusters.some(cluster =>
        cluster.expressionGroups.some(group => group.anchor.id === targetId || (targetArk && group.anchor.ark === targetArk)),
      )
    }

    if (selected.entityType === 'manifestation') {
      const targetId = selected.id
      const targetArk = record?.ark ?? null
      return workspace.clusters.some(cluster =>
        cluster.expressionGroups.some(group =>
          group.anchor.manifestations.some(item => item.id === targetId || (targetArk && item.ark === targetArk)),
        ),
      )
    }

    return false
  }, [record, state.selectedEntity, workspace.clusters])

  const isRecordClustered = useMemo(() => {
    if (!record) return false
    switch (record.typeNorm) {
      case 'oeuvre':
        return isWorkClustered(record, workspace.coverage)
      case 'expression':
        return isExpressionClustered(record, workspace.coverage)
      case 'manifestation':
        return isManifestationClustered(record, workspace.coverage)
      default:
        return false
    }
  }, [record, workspace.coverage])

  const canEditRecord = useMemo(() => {
    if (!record) return false
    if (record.typeNorm === 'manifestation') return true
    if (!isRecordClustered) return true
    return isAnchorSelection
  }, [isAnchorSelection, isRecordClustered, record])

  const readOnlyReason = useMemo(() => {
    if (!record) return null
    if (record.typeNorm !== 'manifestation' && isRecordClustered && !isAnchorSelection)
      return t('messages.clusteredRecordReadOnly')
    return null
  }, [isAnchorSelection, isRecordClustered, record, t])

  return { isAnchorSelection, isRecordClustered, canEditRecord, readOnlyReason }
}

import { useCallback, useMemo, useState } from 'react'
import { expressionsShareParentWork, expressionWorkArks, worksClusteredTogether } from '../../core/entities'
import { isClusterAnchorCreated } from '../../lib/intermarc'
import { updateManualCluster } from '../../lib/api'
import type { Cluster, RecordRow } from '../../types'
import type { DatasetRecordPayload, WorkspaceUpdatePayload } from '../../lib/api'
import type { WorkspaceContextMenuState } from './types'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type UseWorkspaceClusteringArgs = {
  datasetId: string | null
  clusters: Cluster[]
  getById: (id: string) => RecordRow | null
  applyServerUpdates: (updates: DatasetRecordPayload[]) => void
  applyServerWorkspaceUpdates: (payload: WorkspaceUpdatePayload) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
}

export function useWorkspaceClustering({
  datasetId,
  clusters,
  getById,
  applyServerUpdates,
  applyServerWorkspaceUpdates,
  showToast,
  t,
  setContextMenu,
}: UseWorkspaceClusteringArgs) {
  const [pendingClusterSourceId, setPendingClusterSourceId] = useState<string | null>(null)
  const [pendingClusterTarget, setPendingClusterTarget] = useState<{ anchorId: string; sourceId: string } | null>(
    null,
  )
  const [pendingExpressionClusterSourceId, setPendingExpressionClusterSourceId] = useState<string | null>(null)
  const [pendingExpressionClusterTarget, setPendingExpressionClusterTarget] = useState<{
    anchorId: string
    sourceId: string
  } | null>(null)

  const pendingClusterSourceRecord = useMemo(
    () => (pendingClusterSourceId ? getById(pendingClusterSourceId) ?? null : null),
    [getById, pendingClusterSourceId],
  )

  const pendingExpressionClusterSourceRecord = useMemo(
    () => (pendingExpressionClusterSourceId ? getById(pendingExpressionClusterSourceId) ?? null : null),
    [getById, pendingExpressionClusterSourceId],
  )

  const workClusterIndex = useMemo(() => {
    const index = new Map<string, { anchorId: string; anchorLabel?: string | null }>()
    clusters.forEach(cluster => {
      cluster.items.forEach(item => {
        if (!item.ark || index.has(item.ark)) return
        index.set(item.ark, { anchorId: cluster.anchorId, anchorLabel: cluster.anchorTitle })
      })
    })
    return index
  }, [clusters])

  const expressionClusterIndex = useMemo(() => {
    const index = new Map<string, { anchorId: string; anchorExpressionId: string; anchorLabel?: string | null }>()
    clusters.forEach(cluster => {
      cluster.expressionGroups.forEach(group => {
        group.clustered.forEach(item => {
          const anchorLabel = group.anchor.title || group.anchor.id || undefined
          if (item.ark && !index.has(item.ark)) {
            index.set(item.ark, { anchorId: cluster.anchorId, anchorExpressionId: group.anchor.id, anchorLabel })
          }
          if (item.id && !index.has(item.id)) {
            index.set(item.id, { anchorId: cluster.anchorId, anchorExpressionId: group.anchor.id, anchorLabel })
          }
        })
      })
    })
    return index
  }, [clusters])

  const getExpressionClusterMembership = useCallback(
    (target: RecordRow | null) => {
      if (!target || target.typeNorm !== 'expression') return null
      const candidates = [target.ark, target.id].filter(Boolean) as string[]
      for (const key of candidates) {
        const info = expressionClusterIndex.get(key)
        if (info) return info
      }
      return null
    },
    [expressionClusterIndex],
  )

  const isProtectedWorkAnchor = useCallback((target: RecordRow | null) => {
    if (!target || target.typeNorm !== 'oeuvre') return false
    return isClusterAnchorCreated(target.intermarc)
  }, [])

  const isProtectedExpressionAnchor = useCallback((target: RecordRow | null) => {
    if (!target || target.typeNorm !== 'expression') return false
    return isClusterAnchorCreated(target.intermarc)
  }, [])

  const cancelPendingCluster = useCallback(() => {
    setPendingClusterSourceId(null)
    setPendingClusterTarget(null)
  }, [])

  const cancelPendingExpressionCluster = useCallback(() => {
    setPendingExpressionClusterSourceId(null)
    setPendingExpressionClusterTarget(null)
  }, [])

  const prepareForClustering = useCallback(
    (target: RecordRow) => {
      if (target.typeNorm !== 'oeuvre') return
      if (!target.ark) {
        showToast(t('works.cluster.missingArk', { defaultValue: "Impossible : l'œuvre n'a pas d'ARK." }), {
          tone: 'error',
        })
        setContextMenu(null)
        return
      }
      if (isProtectedWorkAnchor(target)) {
        showToast(
          t('works.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cette œuvre est déjà ancre d’un cluster.',
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingClusterSourceId(target.id)
      setContextMenu(null)
      showToast(t('works.cluster.prepared', { defaultValue: 'Œuvre mise en attente pour un clustering.' }), {
        tone: 'info',
      })
    },
    [isProtectedWorkAnchor, setContextMenu, showToast, t],
  )

  const requestClusterWith = useCallback(
    (anchor: RecordRow) => {
      if (!pendingClusterSourceRecord || anchor.typeNorm !== 'oeuvre') return
      if (pendingClusterSourceRecord.typeNorm !== 'oeuvre') return
      if (isProtectedWorkAnchor(pendingClusterSourceRecord)) {
        showToast(
          t('works.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cette œuvre est déjà ancre d’un cluster.',
          }),
          { tone: 'error' },
        )
        setPendingClusterSourceId(null)
        return
      }
      setPendingClusterTarget({ anchorId: anchor.id, sourceId: pendingClusterSourceRecord.id })
      setContextMenu(null)
    },
    [isProtectedWorkAnchor, pendingClusterSourceRecord, setContextMenu, showToast, t],
  )

  const confirmPendingCluster = useCallback(async () => {
    if (!pendingClusterTarget) return
    const source = getById(pendingClusterTarget.sourceId)
    const anchor = getById(pendingClusterTarget.anchorId)
    if (!source || !anchor) {
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }
    if (!datasetId) {
      showToast(t('works.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }
    if (!source.ark) {
      showToast(t('works.cluster.missingArk', { defaultValue: "Impossible : l'œuvre n'a pas d'ARK." }), {
        tone: 'error',
      })
      setPendingClusterTarget(null)
      return
    }
    if (isProtectedWorkAnchor(source)) {
      showToast(
        t('works.cluster.targetIsAnchor', { defaultValue: 'Impossible : cette œuvre est déjà ancre d’un cluster.' }),
        { tone: 'error' },
      )
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }
    const conflict = workClusterIndex.get(source.ark)
    if (conflict && conflict.anchorId !== anchor.id) {
      const label = conflict.anchorLabel || conflict.anchorId
      showToast(
        t('works.cluster.pendingAlreadySelected', {
          defaultValue: 'Impossible : cette œuvre est déjà rattachée au cluster de {{anchor}}.',
          anchor: label,
        }),
        { tone: 'error' },
      )
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }

    try {
      const updates = await updateManualCluster(datasetId, {
        anchorId: anchor.id,
        targetId: source.id,
        accepted: true,
      })
      applyServerWorkspaceUpdates(updates)
      applyServerUpdates(updates.updatedRecords ?? [])
      showToast(t('works.cluster.success', { defaultValue: 'Œuvre ajoutée au cluster.' }), { tone: 'success' })
    } catch (error) {
      console.error(error)
      showToast(t('works.cluster.failed', { defaultValue: 'Échec de la clusterisation.' }), { tone: 'error' })
    } finally {
      setPendingClusterSourceId(null)
      setPendingClusterTarget(null)
    }
  }, [
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    datasetId,
    getById,
    isProtectedWorkAnchor,
    pendingClusterTarget,
    showToast,
    t,
    workClusterIndex,
  ])

  const prepareExpressionForClustering = useCallback(
    (target: RecordRow) => {
      if (target.typeNorm !== 'expression') return
      if (!target.ark) {
        showToast(
          t('expressions.cluster.missingArk', { defaultValue: "Impossible : l'expression n'a pas d'ARK." }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      if (isProtectedExpressionAnchor(target)) {
        showToast(
          t('expressions.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cette expression est déjà ancre d’un cluster.',
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      const membership = getExpressionClusterMembership(target)
      if (membership) {
        showToast(
          t('expressions.cluster.alreadyClustered', {
            defaultValue: 'Impossible : cette expression est déjà rattachée au cluster de {{anchor}}.',
            anchor: membership.anchorLabel || membership.anchorExpressionId,
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingExpressionClusterSourceId(target.id)
      setContextMenu(null)
      showToast(t('expressions.cluster.prepared', { defaultValue: 'Expression mise en attente pour clustering.' }), {
        tone: 'info',
      })
    },
    [
      getExpressionClusterMembership,
      isProtectedExpressionAnchor,
      setContextMenu,
      showToast,
      t,
    ],
  )

  const requestExpressionClusterWith = useCallback(
    (anchor: RecordRow) => {
      if (anchor.typeNorm !== 'expression' || !pendingExpressionClusterSourceRecord) return
      const sourceMembership = getExpressionClusterMembership(pendingExpressionClusterSourceRecord)
      if (sourceMembership) {
        showToast(
          t('expressions.cluster.alreadyClustered', {
            defaultValue: 'Impossible : cette expression est déjà rattachée au cluster de {{anchor}}.',
            anchor: sourceMembership.anchorLabel || sourceMembership.anchorExpressionId,
          }),
          { tone: 'error' },
        )
        setPendingExpressionClusterSourceId(null)
        return
      }
      const anchorMembership = getExpressionClusterMembership(anchor)
      if (anchorMembership) {
        showToast(
          t('expressions.cluster.anchorAlreadyClustered', {
            defaultValue:
              "Impossible : une expression déjà rattachée à un cluster ne peut pas en être l'ancre.",
            anchor: anchorMembership.anchorLabel || anchorMembership.anchorExpressionId,
          }),
          { tone: 'error' },
        )
        return
      }
      const sameParent = expressionsShareParentWork(anchor, pendingExpressionClusterSourceRecord)
      const clusteredParents = worksClusteredTogether(
        expressionWorkArks(anchor)[0],
        expressionWorkArks(pendingExpressionClusterSourceRecord)[0],
        clusters,
      )
      if (!sameParent && !clusteredParents) {
        showToast(
          t('expressions.cluster.parentMismatch', {
            defaultValue: 'Impossible : les expressions doivent partager la même œuvre parente.',
          }),
          { tone: 'error' },
        )
        setPendingExpressionClusterSourceId(null)
        return
      }
      if (isProtectedExpressionAnchor(pendingExpressionClusterSourceRecord)) {
        showToast(
          t('expressions.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cette expression est déjà ancre d’un cluster.',
          }),
          { tone: 'error' },
        )
        setPendingExpressionClusterSourceId(null)
        return
      }
      setPendingExpressionClusterTarget({ anchorId: anchor.id, sourceId: pendingExpressionClusterSourceRecord.id })
      setContextMenu(null)
    },
    [
      clusters,
      getExpressionClusterMembership,
      isProtectedExpressionAnchor,
      pendingExpressionClusterSourceRecord,
      setContextMenu,
      showToast,
      t,
    ],
  )

  const confirmPendingExpressionCluster = useCallback(async () => {
    if (!pendingExpressionClusterTarget) return
    const source = getById(pendingExpressionClusterTarget.sourceId)
    const anchor = getById(pendingExpressionClusterTarget.anchorId)
    if (!source || !anchor) {
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }
    if (!datasetId) {
      showToast(t('expressions.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }
    if (!source.ark) {
      showToast(
        t('expressions.cluster.missingArk', { defaultValue: "Impossible : l'expression n'a pas d'ARK." }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      return
    }
    const anchorMembership = getExpressionClusterMembership(anchor)
    if (anchorMembership) {
      showToast(
        t('expressions.cluster.anchorAlreadyClustered', {
          defaultValue: "Impossible : une expression déjà rattachée à un cluster ne peut pas en être l'ancre.",
          anchor: anchorMembership.anchorLabel || anchorMembership.anchorExpressionId,
        }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      return
    }
    const sourceMembership = getExpressionClusterMembership(source)
    if (sourceMembership && sourceMembership.anchorExpressionId !== anchor.id) {
      showToast(
        t('expressions.cluster.alreadyClustered', {
          defaultValue: 'Impossible : cette expression est déjà rattachée au cluster de {{anchor}}.',
          anchor: sourceMembership.anchorLabel || sourceMembership.anchorExpressionId,
        }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }
    const sameParent = expressionsShareParentWork(anchor, source)
    const clusteredParents = worksClusteredTogether(
      expressionWorkArks(anchor)[0],
      expressionWorkArks(source)[0],
      clusters,
    )
    if (!sameParent && !clusteredParents) {
      showToast(
        t('expressions.cluster.parentMismatch', {
          defaultValue: 'Impossible : les expressions doivent partager la même œuvre parente.',
        }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }
    if (isProtectedExpressionAnchor(source)) {
      showToast(
        t('expressions.cluster.targetIsAnchor', {
          defaultValue: 'Impossible : cette expression est déjà ancre d’un cluster.',
        }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }
    const conflict = expressionClusterIndex.get(source.ark)
    if (conflict && conflict.anchorExpressionId !== anchor.id) {
      showToast(
        t('expressions.cluster.pendingAlreadySelected', {
          defaultValue: 'Impossible : cette expression est déjà rattachée à un autre cluster.',
        }),
        { tone: 'error' },
      )
      setPendingExpressionClusterTarget(null)
      setPendingExpressionClusterSourceId(null)
      return
    }

    try {
      const updates = await updateManualCluster(datasetId, {
        anchorId: anchor.id,
        targetId: source.id,
        accepted: true,
      })
      applyServerWorkspaceUpdates(updates)
      applyServerUpdates(updates.updatedRecords ?? [])
      showToast(t('expressions.cluster.success', { defaultValue: 'Expression ajoutée au cluster.' }), {
        tone: 'success',
      })
    } catch (error) {
      console.error(error)
      showToast(
        t('expressions.cluster.failed', { defaultValue: 'Échec de la clusterisation.' }),
        { tone: 'error' },
      )
    } finally {
      setPendingExpressionClusterSourceId(null)
      setPendingExpressionClusterTarget(null)
    }
  }, [
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    clusters,
    datasetId,
    expressionClusterIndex,
    getById,
    getExpressionClusterMembership,
    isProtectedExpressionAnchor,
    pendingExpressionClusterTarget,
    showToast,
    t,
  ])

  const toggleWorkClusterMembership = useCallback(
    async ({
      clusterId,
      workArk,
      workId,
      accepted,
    }: {
      clusterId: string
      workArk: string
      workId?: string | null
      accepted: boolean
    }) => {
      if (!datasetId) {
        showToast(t('works.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
        return
      }
      if (!workArk) return
      try {
        const updates = await updateManualCluster(datasetId, {
          anchorId: clusterId,
          targetArk: workArk,
          targetId: accepted ? workId ?? undefined : undefined,
          accepted,
        })
        applyServerWorkspaceUpdates(updates)
        applyServerUpdates(updates.updatedRecords ?? [])
        showToast(
          accepted
            ? t('works.cluster.success', { defaultValue: 'Œuvre ajoutée au cluster.' })
            : t('works.cluster.removed', { defaultValue: 'Œuvre retirée du cluster.' }),
          { tone: 'success' },
        )
      } catch (error) {
        console.error(error)
        showToast(
          accepted
            ? t('works.cluster.failed', { defaultValue: 'Échec de la clusterisation.' })
            : t('works.cluster.removeFailed', { defaultValue: 'Échec du retrait du cluster.' }),
          { tone: 'error' },
        )
      }
    },
    [applyServerUpdates, applyServerWorkspaceUpdates, datasetId, showToast, t],
  )

  const toggleExpressionClusterMembership = useCallback(
    async ({
      anchorExpressionId,
      expressionArk,
      expressionId,
      accepted,
    }: {
      anchorExpressionId: string
      expressionArk: string
      expressionId?: string | null
      accepted: boolean
    }) => {
      if (!datasetId) {
        showToast(t('expressions.cluster.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
        return
      }
      if (!expressionArk) return
      try {
        const updates = await updateManualCluster(datasetId, {
          anchorId: anchorExpressionId,
          targetArk: expressionArk,
          targetId: accepted ? expressionId ?? undefined : undefined,
          accepted,
        })
        applyServerWorkspaceUpdates(updates)
        applyServerUpdates(updates.updatedRecords ?? [])
        showToast(
          accepted
            ? t('expressions.cluster.success', { defaultValue: 'Expression ajoutée au cluster.' })
            : t('expressions.cluster.removed', { defaultValue: 'Expression retirée du cluster.' }),
          { tone: 'success' },
        )
      } catch (error) {
        console.error(error)
        showToast(
          accepted
            ? t('expressions.cluster.failed', { defaultValue: 'Échec de la clusterisation.' })
            : t('expressions.cluster.removeFailed', { defaultValue: 'Échec du retrait du cluster.' }),
          { tone: 'error' },
        )
      }
    },
    [applyServerUpdates, applyServerWorkspaceUpdates, datasetId, showToast, t],
  )

  return {
    cancelPendingCluster,
    cancelPendingExpressionCluster,
    confirmPendingCluster,
    confirmPendingExpressionCluster,
    expressionClusterIndex,
    getExpressionClusterMembership,
    isProtectedExpressionAnchor,
    isProtectedWorkAnchor,
    pendingClusterSourceId,
    pendingClusterSourceRecord,
    pendingClusterTarget,
    pendingExpressionClusterSourceId,
    pendingExpressionClusterSourceRecord,
    pendingExpressionClusterTarget,
    prepareExpressionForClustering,
    prepareForClustering,
    requestClusterWith,
    requestExpressionClusterWith,
    toggleWorkClusterMembership,
    toggleExpressionClusterMembership,
    workClusterIndex,
  }
}

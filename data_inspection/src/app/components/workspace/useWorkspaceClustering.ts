import { useCallback, useMemo, useState } from 'react'
import { expressionsShareParentWork, expressionWorkArks, worksClusteredTogether } from '../../core/entities'
import { addManualWork90FEntries, addManualExpression90FEntries, isClusterAnchorCreated } from '../../lib/intermarc'
import type { Cluster, RecordRow } from '../../types'
import type { WorkspaceContextMenuState } from './types'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type UseWorkspaceClusteringArgs = {
  clusters: Cluster[]
  getById: (id: string) => RecordRow | null
  updateRecordIntermarc: (id: string, intermarc: import('../../lib/intermarc').Intermarc) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
}

export function useWorkspaceClustering({
  clusters,
  getById,
  updateRecordIntermarc,
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

  const confirmPendingCluster = useCallback(() => {
    if (!pendingClusterTarget) return
    const source = getById(pendingClusterTarget.sourceId)
    const anchor = getById(pendingClusterTarget.anchorId)
    if (!source || !anchor) {
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

    const manualTargets = new Set<string>()
    const anchorCluster = clusters.find(c => c.anchorId === anchor.id)
    anchorCluster?.items.forEach(item => {
      if (item.origin === 'manual' && item.ark) manualTargets.add(item.ark)
    })
    manualTargets.add(source.ark)

    const nextIntermarc = addManualWork90FEntries(
      anchor.intermarc,
      [...manualTargets].map(ark => ({ ark })),
    )
    updateRecordIntermarc(anchor.id, nextIntermarc)
    setPendingClusterSourceId(null)
    setPendingClusterTarget(null)
    showToast(t('works.cluster.success', { defaultValue: 'Œuvre ajoutée au cluster.' }), { tone: 'success' })
  }, [
    clusters,
    getById,
    isProtectedWorkAnchor,
    pendingClusterTarget,
    showToast,
    t,
    updateRecordIntermarc,
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

  const confirmPendingExpressionCluster = useCallback(() => {
    if (!pendingExpressionClusterTarget) return
    const source = getById(pendingExpressionClusterTarget.sourceId)
    const anchor = getById(pendingExpressionClusterTarget.anchorId)
    if (!source || !anchor) {
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

    const manualTargets = new Set<string>()
    const anchorGroup = clusters
      .find(c => c.expressionGroups.some(g => g.anchor.id === anchor.id))
      ?.expressionGroups.find(g => g.anchor.id === anchor.id)
    anchorGroup?.clustered.forEach(item => {
      if (item.origin === 'manual' && item.ark) manualTargets.add(item.ark)
    })
    manualTargets.add(source.ark)

    const nextIntermarc = addManualExpression90FEntries(anchor.intermarc, [...manualTargets].map(ark => ({ ark })))
    updateRecordIntermarc(anchor.id, nextIntermarc)
    setPendingExpressionClusterSourceId(null)
    setPendingExpressionClusterTarget(null)
    showToast(t('expressions.cluster.success', { defaultValue: 'Expression ajoutée au cluster.' }), { tone: 'success' })
  }, [
    clusters,
    expressionClusterIndex,
    getById,
    getExpressionClusterMembership,
    isProtectedExpressionAnchor,
    pendingExpressionClusterTarget,
    showToast,
    t,
    updateRecordIntermarc,
  ])

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
    workClusterIndex,
  }
}

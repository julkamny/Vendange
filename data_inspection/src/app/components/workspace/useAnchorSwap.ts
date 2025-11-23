import { useCallback, useMemo, useState } from 'react'
import { swapClusterAnchor, type DatasetRecordPayload } from '../../lib/api'
import type { RecordRow } from '../../types'
import type { WorkspaceContextMenuState } from './types'
import type { MenuAction } from '../WorkspaceContextMenu'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type AnchorSwapHookArgs = {
  datasetId: string | null
  workClusterIndex: Map<string, { anchorId: string; anchorLabel?: string | null }>
  expressionClusterIndex: Map<string, { anchorId: string; anchorExpressionId: string; anchorLabel?: string | null }>
  getById: (id: string) => RecordRow | null
  applyServerUpdates: (updates: DatasetRecordPayload[]) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
}

export function useAnchorSwap({
  datasetId,
  workClusterIndex,
  expressionClusterIndex,
  getById,
  applyServerUpdates,
  showToast,
  t,
  setContextMenu,
}: AnchorSwapHookArgs) {
  const [pendingWorkSourceId, setPendingWorkSourceId] = useState<string | null>(null)
  const [pendingWorkTarget, setPendingWorkTarget] = useState<{ anchorId: string; sourceId: string } | null>(null)
  const [pendingExpressionSourceId, setPendingExpressionSourceId] = useState<string | null>(null)
  const [pendingExpressionTarget, setPendingExpressionTarget] = useState<{ anchorId: string; sourceId: string } | null>(
    null,
  )

  const pendingWorkSourceRecord = useMemo(
    () => (pendingWorkSourceId ? getById(pendingWorkSourceId) : null),
    [getById, pendingWorkSourceId],
  )
  const pendingExpressionSourceRecord = useMemo(
    () => (pendingExpressionSourceId ? getById(pendingExpressionSourceId) : null),
    [getById, pendingExpressionSourceId],
  )

  const getWorkMembership = useCallback(
    (record: RecordRow | null) => {
      if (!record || record.typeNorm !== 'oeuvre') return null
      const candidates = [record.ark, record.id].filter(Boolean) as string[]
      for (const candidate of candidates) {
        const info = workClusterIndex.get(candidate)
        if (info) return info
      }
      return null
    },
    [workClusterIndex],
  )

  const getExpressionMembership = useCallback(
    (record: RecordRow | null) => {
      if (!record || record.typeNorm !== 'expression') return null
      const candidates = [record.ark, record.id].filter(Boolean) as string[]
      for (const candidate of candidates) {
        const info = expressionClusterIndex.get(candidate)
        if (info) return info
      }
      return null
    },
    [expressionClusterIndex],
  )

  const resetWorkSwap = useCallback(() => {
    setPendingWorkSourceId(null)
    setPendingWorkTarget(null)
  }, [])

  const resetExpressionSwap = useCallback(() => {
    setPendingExpressionSourceId(null)
    setPendingExpressionTarget(null)
  }, [])

  const prepareWorkAnchorSwap = useCallback(
    (record: RecordRow) => {
      if (record.typeNorm !== 'oeuvre') return
      const membership = getWorkMembership(record)
      if (!membership) {
        showToast(
          t('works.anchorSwap.notInCluster', {
            defaultValue: "Impossible : l'œuvre n'est pas dans un cluster.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingWorkSourceId(record.id)
      setContextMenu(null)
      showToast(t('works.anchorSwap.prepared', { defaultValue: "Œuvre prête pour changement d'ancre." }), {
        tone: 'info',
      })
    },
    [getWorkMembership, setContextMenu, showToast, t],
  )

  const prepareExpressionAnchorSwap = useCallback(
    (record: RecordRow) => {
      if (record.typeNorm !== 'expression') return
      const membership = getExpressionMembership(record)
      if (!membership) {
        showToast(
          t('expressions.anchorSwap.notInCluster', {
            defaultValue: "Impossible : l'expression n'est pas dans un cluster.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingExpressionSourceId(record.id)
      setContextMenu(null)
      showToast(t('expressions.anchorSwap.prepared', { defaultValue: "Expression prête pour changement d'ancre." }), {
        tone: 'info',
      })
    },
    [getExpressionMembership, setContextMenu, showToast, t],
  )

  const requestWorkAnchorSwap = useCallback(
    (anchor: RecordRow) => {
      if (!pendingWorkSourceRecord) return
      const membership = getWorkMembership(pendingWorkSourceRecord)
      if (!membership) {
        resetWorkSwap()
        return
      }

      const anchorMembership = getWorkMembership(anchor)
      const sameCluster =
        anchor.id === membership.anchorId || (anchorMembership && anchorMembership.anchorId === membership.anchorId)
      if (!sameCluster) {
        showToast(
          t('works.anchorSwap.wrongCluster', {
            defaultValue: 'Impossible : sélectionner une œuvre du même cluster.',
          }),
          { tone: 'error' },
        )
        return
      }

      if (anchor.id !== membership.anchorId) {
        showToast(
          t('works.anchorSwap.notAnchor', {
            defaultValue: "Impossible : cette œuvre n'est pas l'ancre du cluster.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }

      setPendingWorkTarget({ anchorId: anchor.id, sourceId: pendingWorkSourceRecord.id })
      setContextMenu(null)
    },
    [getWorkMembership, pendingWorkSourceRecord, resetWorkSwap, setContextMenu, showToast, t],
  )

  const requestExpressionAnchorSwap = useCallback(
    (anchor: RecordRow) => {
      if (!pendingExpressionSourceRecord) return
      const membership = getExpressionMembership(pendingExpressionSourceRecord)
      if (!membership) {
        resetExpressionSwap()
        return
      }

      const anchorMembership = getExpressionMembership(anchor)
      const sameCluster =
        anchor.id === membership.anchorExpressionId ||
        (anchorMembership && anchorMembership.anchorId === membership.anchorId)
      if (!sameCluster) {
        showToast(
          t('expressions.anchorSwap.wrongCluster', {
            defaultValue: "Impossible : choisir l'expression du même cluster.",
          }),
          { tone: 'error' },
        )
        return
      }

      if (anchor.id !== membership.anchorExpressionId) {
        showToast(
          t('expressions.anchorSwap.notAnchor', {
            defaultValue: "Impossible : cette expression n'est pas l'ancre du cluster.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }

      setPendingExpressionTarget({ anchorId: anchor.id, sourceId: pendingExpressionSourceRecord.id })
      setContextMenu(null)
    },
    [getExpressionMembership, pendingExpressionSourceRecord, resetExpressionSwap, setContextMenu, showToast, t],
  )

  const confirmWorkAnchorSwap = useCallback(async () => {
    if (!pendingWorkTarget) return
    if (!datasetId) {
      showToast(t('works.anchorSwap.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
      resetWorkSwap()
      return
    }
    try {
      const updates = await swapClusterAnchor(datasetId, {
        anchorId: pendingWorkTarget.anchorId,
        targetId: pendingWorkTarget.sourceId,
      })
      applyServerUpdates(updates)
      showToast(t('works.anchorSwap.success', { defaultValue: "Ancre du cluster mise à jour." }), {
        tone: 'success',
      })
    } catch (error) {
      console.error(error)
      showToast(
        t('works.anchorSwap.failed', { defaultValue: "Échec du changement d'ancre." }),
        { tone: 'error' },
      )
    } finally {
      resetWorkSwap()
    }
  }, [applyServerUpdates, datasetId, pendingWorkTarget, resetWorkSwap, showToast, t])

  const confirmExpressionAnchorSwap = useCallback(async () => {
    if (!pendingExpressionTarget) return
    if (!datasetId) {
      showToast(t('expressions.anchorSwap.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
      resetExpressionSwap()
      return
    }
    try {
      const updates = await swapClusterAnchor(datasetId, {
        anchorId: pendingExpressionTarget.anchorId,
        targetId: pendingExpressionTarget.sourceId,
      })
      applyServerUpdates(updates)
      showToast(
        t('expressions.anchorSwap.success', { defaultValue: "Ancre du cluster d'expressions mise à jour." }),
        { tone: 'success' },
      )
    } catch (error) {
      console.error(error)
      showToast(
        t('expressions.anchorSwap.failed', { defaultValue: "Échec du changement d'ancre." }),
        { tone: 'error' },
      )
    } finally {
      resetExpressionSwap()
    }
  }, [applyServerUpdates, datasetId, pendingExpressionTarget, resetExpressionSwap, showToast, t])

  const getWorkAnchorSwapAction = useCallback(
    (record: RecordRow | null): MenuAction | null => {
      if (!record || record.typeNorm !== 'oeuvre') return null

      if (!pendingWorkSourceId) {
        const membership = getWorkMembership(record)
        if (!membership) return null
        return {
          label: t('works.anchorSwap.prepare', { defaultValue: 'Préparer pour changement d’ancre' }),
          onSelect: () => prepareWorkAnchorSwap(record),
        }
      }

      if (pendingWorkSourceId === record.id) {
        return {
          label: t('works.anchorSwap.cancel', { defaultValue: 'Annuler le changement d’ancre' }),
          onSelect: resetWorkSwap,
        }
      }

      const sourceMembership = getWorkMembership(pendingWorkSourceRecord)
      if (!sourceMembership) return null

      const candidateMembership = getWorkMembership(record)
      const sameCluster =
        record.id === sourceMembership.anchorId ||
        (candidateMembership && candidateMembership.anchorId === sourceMembership.anchorId)
      if (!sameCluster) return null

      return {
        label: t('works.anchorSwap.perform', { defaultValue: 'Effectuer le changement d’ancre' }),
        onSelect: () => requestWorkAnchorSwap(record),
      }
    },
    [
      getWorkMembership,
      pendingWorkSourceId,
      pendingWorkSourceRecord,
      prepareWorkAnchorSwap,
      requestWorkAnchorSwap,
      resetWorkSwap,
      t,
    ],
  )

  const getExpressionAnchorSwapAction = useCallback(
    (record: RecordRow | null): MenuAction | null => {
      if (!record || record.typeNorm !== 'expression') return null

      if (!pendingExpressionSourceId) {
        const membership = getExpressionMembership(record)
        if (!membership) return null
        return {
          label: t('expressions.anchorSwap.prepare', { defaultValue: 'Préparer pour changement d’ancre' }),
          onSelect: () => prepareExpressionAnchorSwap(record),
        }
      }

      if (pendingExpressionSourceId === record.id) {
        return {
          label: t('expressions.anchorSwap.cancel', { defaultValue: 'Annuler le changement d’ancre' }),
          onSelect: resetExpressionSwap,
        }
      }

      const sourceMembership = getExpressionMembership(pendingExpressionSourceRecord)
      if (!sourceMembership) return null
      const candidateMembership = getExpressionMembership(record)
      const sameCluster =
        record.id === sourceMembership.anchorExpressionId ||
        (candidateMembership && candidateMembership.anchorId === sourceMembership.anchorId)
      if (!sameCluster) return null

      return {
        label: t('expressions.anchorSwap.perform', { defaultValue: 'Effectuer le changement d’ancre' }),
        onSelect: () => requestExpressionAnchorSwap(record),
      }
    },
    [
      getExpressionMembership,
      pendingExpressionSourceId,
      pendingExpressionSourceRecord,
      prepareExpressionAnchorSwap,
      requestExpressionAnchorSwap,
      resetExpressionSwap,
      t,
    ],
  )

  return {
    getWorkAnchorSwapAction,
    getExpressionAnchorSwapAction,
    pendingWorkAnchorSwapSourceRecord: pendingWorkSourceRecord,
    pendingWorkAnchorSwapTarget: pendingWorkTarget,
    pendingExpressionAnchorSwapSourceRecord: pendingExpressionSourceRecord,
    pendingExpressionAnchorSwapTarget: pendingExpressionTarget,
    confirmWorkAnchorSwap,
    confirmExpressionAnchorSwap,
    cancelWorkAnchorSwap: resetWorkSwap,
    cancelExpressionAnchorSwap: resetExpressionSwap,
  }
}

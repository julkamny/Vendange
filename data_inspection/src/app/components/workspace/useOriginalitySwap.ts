import { useCallback, useMemo, useState } from 'react'
import { swapWorkOriginality, type DatasetRecordPayload, type WorkspaceUpdatePayload } from '../../lib/api'
import type { Cluster, RecordRow } from '../../types'
import type { Intermarc, Zone } from '../../lib/intermarc'
import type { WorkspaceContextMenuState } from './types'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type UseOriginalitySwapArgs = {
  datasetId: string | null
  clusters: Cluster[]
  workClusterIndex: Map<string, { anchorId: string; anchorLabel?: string | null }>
  getById: (id: string) => RecordRow | null
  applyServerUpdates: (updates: DatasetRecordPayload[]) => void
  applyServerWorkspaceUpdates: (payload: WorkspaceUpdatePayload) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
  findControlledValueArk: (label: string) => string | null
}

type PendingOriginalityTarget = { sourceId: string; targetId: string } | null

export function useOriginalitySwap({
  datasetId,
  clusters,
  workClusterIndex,
  getById,
  applyServerUpdates,
  applyServerWorkspaceUpdates,
  showToast,
  t,
  setContextMenu,
  findControlledValueArk,
}: UseOriginalitySwapArgs) {
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<PendingOriginalityTarget>(null)

  const pendingSourceRecord = useMemo(
    () => (pendingSourceId ? getById(pendingSourceId) : null),
    [getById, pendingSourceId],
  )

  const anchorIds = useMemo(() => new Set(clusters.map(cluster => cluster.anchorId)), [clusters])

  const adaptationQualifier = useMemo(() => findControlledValueArk('A pour adaptation'), [findControlledValueArk])

  const adaptationOfQualifier = useMemo(
    () => findControlledValueArk('Est une adaptation de'),
    [findControlledValueArk],
  )

  const hasManualOrCreatedFlag = useCallback((zone: Zone) => {
    const flags = [zone.affectedByCuration, ...(zone.sousZones?.map(sz => sz.affectedByCuration).filter(Boolean) ?? [])]
    return flags.some(flag => typeof flag === 'string' && ['manual', 'created'].includes(flag.toLowerCase()))
  }, [])

  const hasQualifier = useCallback((zone: Zone, qualifier: string | null, label: string) => {
    if (!qualifier) return true
    const fallbackLabel = label.trim().toLowerCase()
    return zone.sousZones?.some(sub => {
      if (sub.code !== '552$q') return false
      if (qualifier && sub.valeur === qualifier) return true
      return typeof sub.valeur === 'string' && sub.valeur.trim().toLowerCase() === fallbackLabel
    })
  }, [])

  const extractOutgoingAdaptations = useCallback(
    (record: RecordRow | null): string[] => {
      if (!record || record.typeNorm !== 'oeuvre') return []
      const qualifier = adaptationQualifier
      const zones = (record.intermarc as Intermarc).zones?.filter(z => z.code === '552') ?? []
      const targets = new Set<string>()
      zones.forEach(zone => {
        if (!hasQualifier(zone, qualifier, 'A pour adaptation')) return
        if (!hasManualOrCreatedFlag(zone)) return
        const target = zone.sousZones?.find(sz => sz.code === '552$3')?.valeur?.trim()
        if (target) targets.add(target)
      })
      return Array.from(targets)
    },
    [adaptationQualifier, hasManualOrCreatedFlag, hasQualifier],
  )

  const isClusterMember = useCallback(
    (record: RecordRow | null) => {
      if (!record?.ark) return false
      return workClusterIndex.has(record.ark)
    },
    [workClusterIndex],
  )

  const isAnchor = useCallback((record: RecordRow | null) => Boolean(record && anchorIds.has(record.id)), [anchorIds])

  const isValidTarget = useCallback(
    (record: RecordRow | null) => {
      if (!record || record.typeNorm !== 'oeuvre') return false
      if (!record.ark) return false
      if (isAnchor(record)) return true
      return !isClusterMember(record)
    },
    [isAnchor, isClusterMember],
  )

  const reset = useCallback(() => {
    setPendingSourceId(null)
    setPendingTarget(null)
  }, [])

  const prepareOriginalitySwap = useCallback(
    (record: RecordRow) => {
      const targets = extractOutgoingAdaptations(record)
      if (!targets.length) return
      setPendingSourceId(record.id)
      setPendingTarget(null)
      setContextMenu(null)
      showToast(
        t('works.originalitySwap.prepared', { defaultValue: "Œuvre prête pour transfert d'originalité." }),
        { tone: 'info' },
      )
    },
    [extractOutgoingAdaptations, setContextMenu, showToast, t],
  )

  const requestOriginalityGraft = useCallback(
    (record: RecordRow) => {
      if (!pendingSourceId) return
      if (!isValidTarget(record)) {
        showToast(
          t('works.originalitySwap.invalidTarget', {
            defaultValue: "Impossible : choisir une œuvre indépendante ou l'ancre d'un cluster.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingTarget({ sourceId: pendingSourceId, targetId: record.id })
      setContextMenu(null)
    },
    [isValidTarget, pendingSourceId, setContextMenu, showToast, t],
  )

  const confirmOriginalitySwap = useCallback(async () => {
    if (!pendingTarget) return
    if (!datasetId) {
      showToast(
        t('works.originalitySwap.noDataset', { defaultValue: 'Aucune base chargée.' }),
        { tone: 'error' },
      )
      reset()
      return
    }
    const source = getById(pendingTarget.sourceId)
    const target = getById(pendingTarget.targetId)
    if (!source || !target) {
      reset()
      return
    }
    const outgoing = extractOutgoingAdaptations(source)
    if (!outgoing.length) {
      showToast(
        t('works.originalitySwap.missingAdaptations', {
          defaultValue: "Impossible : l'œuvre sélectionnée ne porte pas de liens d'adaptation manuels.",
        }),
        { tone: 'error' },
      )
      reset()
      return
    }
    try {
      const updates = await swapWorkOriginality(datasetId, {
        originalId: source.id,
        targetId: target.id,
      })
      applyServerWorkspaceUpdates(updates)
      applyServerUpdates(updates.updatedRecords ?? [])
      showToast(
        t('works.originalitySwap.success', { defaultValue: "Originalité transférée vers l'œuvre cible." }),
        { tone: 'success' },
      )
    } catch (error) {
      console.error(error)
      showToast(t('works.originalitySwap.failed', { defaultValue: 'Échec du transfert.' }), { tone: 'error' })
    } finally {
      reset()
    }
  }, [
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    datasetId,
    extractOutgoingAdaptations,
    getById,
    pendingTarget,
    reset,
    showToast,
    t,
  ])

  const cancelOriginalitySwap = useCallback(() => reset(), [reset])

  const getOriginalitySwapAction = useCallback(
    (record: RecordRow | null) => {
      if (!record || record.typeNorm !== 'oeuvre') return null
      const outgoing = extractOutgoingAdaptations(record)

      if (!pendingSourceId) {
        if (!outgoing.length) return null
        return {
          label: t('works.originalitySwap.prepare', { defaultValue: "Retrancher l'originalité de cette œuvre" }),
          onSelect: () => prepareOriginalitySwap(record),
        }
      }

      if (pendingSourceId === record.id) {
        return {
          label: t('works.originalitySwap.cancel', { defaultValue: "Annuler le transfert d'originalité" }),
          onSelect: cancelOriginalitySwap,
        }
      }

      if (!isValidTarget(record)) return null

      return {
        label: t('works.originalitySwap.graft', { defaultValue: "Enter l'originalité de l'œuvre sélectionnée sur celle-ci." }),
        onSelect: () => requestOriginalityGraft(record),
      }
    },
    [
      cancelOriginalitySwap,
      extractOutgoingAdaptations,
      isValidTarget,
      pendingSourceId,
      prepareOriginalitySwap,
      requestOriginalityGraft,
      t,
    ],
  )

  return {
    getOriginalitySwapAction,
    pendingOriginalitySourceRecord: pendingSourceRecord,
    pendingOriginalityTarget: pendingTarget,
    confirmOriginalitySwap,
    cancelOriginalitySwap,
    adaptationOfQualifier,
  }
}

import { useCallback, useMemo, useState } from 'react'
import { manifestationExpressionArks, manifestationTitle } from '../../core/entities'
import { rewriteManifestationExpressionLinks } from '../../core/intermarc-utils'
import type { RecordRow } from '../../types'
import type { WorkspaceContextMenuState } from './types'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type AttachRequest = {
  manifestationId: string
  targetExpressionId: string | null
  targetExpressionArk: string | null
  detachableArks: string[]
  selectedArks: string[]
  partial: boolean
}

type UseManifestationUprootingArgs = {
  getById: (id: string) => RecordRow | null
  updateRecordIntermarc: (recordId: string, intermarc: import('../../lib/intermarc').Intermarc) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
  setContextMenu: (next: WorkspaceContextMenuState | null) => void
  findControlledValueArk: (label: string) => string | null
  sharedPendingManifestationId?: string | null
  setSharedPendingManifestationId?: (next: string | null) => void
}

export function useManifestationUprooting({
  getById,
  updateRecordIntermarc,
  showToast,
  t,
  setContextMenu,
  findControlledValueArk,
  sharedPendingManifestationId,
  setSharedPendingManifestationId,
}: UseManifestationUprootingArgs) {
  const [localPendingManifestationId, setLocalPendingManifestationId] = useState<string | null>(null)
  const [pendingAttach, setPendingAttach] = useState<AttachRequest | null>(null)

  const setPendingManifestationId = useCallback(
    (next: string | null) => {
      setLocalPendingManifestationId(next)
      if (setSharedPendingManifestationId) setSharedPendingManifestationId(next)
    },
    [setSharedPendingManifestationId],
  )

  const pendingManifestationId = sharedPendingManifestationId ?? localPendingManifestationId

  const pendingManifestationRecord = useMemo(
    () => (pendingManifestationId ? getById(pendingManifestationId) ?? null : null),
    [getById, pendingManifestationId],
  )

  const prepareManifestationForUprooting = useCallback(
    (target: RecordRow) => {
      if (target.typeNorm !== 'manifestation') return
      if (pendingManifestationId && pendingManifestationId !== target.id) {
        showToast(
          t('manifestations.uproot.alreadyPending', {
            defaultValue: 'Une manifestation est déjà en attente de déracinage.',
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      setPendingManifestationId(target.id)
      setContextMenu(null)
      const label = manifestationTitle(target) || target.id
      showToast(
        t('manifestations.uproot.prepared', {
          defaultValue: 'Manifestation prête à être déracinée.',
          manifestation: label,
        }),
        { tone: 'info' },
      )
    },
    [pendingManifestationId, setContextMenu, setPendingManifestationId, showToast, t],
  )

  const requestAttachToExpression = useCallback(
    (expression: RecordRow) => {
      if (expression.typeNorm !== 'expression') return
      if (!pendingManifestationId) {
        showToast(
          t('manifestations.uproot.noSelection', { defaultValue: 'Aucune manifestation en attente.' }),
          { tone: 'error' },
        )
        return
      }
      if (!expression.ark) {
        showToast(
          t('manifestations.uproot.targetMissingArk', {
            defaultValue: "Impossible : l'expression n'a pas d'ARK.",
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      const manifestation = getById(pendingManifestationId)
      if (!manifestation) {
        setPendingManifestationId(null)
        setContextMenu(null)
        showToast(
          t('manifestations.uproot.missingManifestation', {
            defaultValue: 'Manifestation introuvable, recommencez.',
          }),
          { tone: 'error' },
        )
        return
      }
      const detachableArks = Array.from(new Set(manifestationExpressionArks(manifestation)))
      if (!detachableArks.length) {
        showToast(
          t('manifestations.uproot.noExpressions', {
            defaultValue: 'Cette manifestation ne référence aucune expression (740$3 manquant).',
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      const selectedArks = detachableArks.length === 1 ? [...detachableArks] : [...detachableArks]
      setPendingAttach({
        manifestationId: manifestation.id,
        targetExpressionId: expression.id,
        targetExpressionArk: expression.ark ?? null,
        detachableArks,
        selectedArks,
        partial: false,
      })
      setContextMenu(null)
    },
    [getById, pendingManifestationId, setContextMenu, setPendingManifestationId, showToast, t],
  )

  const toggleDetachSelection = useCallback((ark: string, checked: boolean) => {
    setPendingAttach(prev => {
      if (!prev) return prev
      const nextSelected = new Set(prev.selectedArks)
      if (checked) nextSelected.add(ark)
      else nextSelected.delete(ark)
      return { ...prev, selectedArks: Array.from(nextSelected) }
    })
  }, [])

  const cancelPendingAttach = useCallback(() => setPendingAttach(null), [])

  const togglePartial = useCallback((checked: boolean) => {
    setPendingAttach(prev => (prev ? { ...prev, partial: checked } : prev))
  }, [])

  const confirmAttach = useCallback(() => {
    if (!pendingAttach) return
    const manifestation = getById(pendingAttach.manifestationId)
    if (!manifestation) {
      setPendingAttach(null)
      setPendingManifestationId(null)
      showToast(
        t('manifestations.uproot.missingManifestation', {
          defaultValue: 'Manifestation introuvable, recommencez.',
        }),
        { tone: 'error' },
      )
      return
    }
    if (!pendingAttach.targetExpressionArk) {
      showToast(
        t('manifestations.uproot.targetMissingArk', {
          defaultValue: "Impossible : l'expression n'a pas d'ARK.",
        }),
        { tone: 'error' },
      )
      return
    }
    if (!pendingAttach.selectedArks.length) {
      // No detach selected: keep existing links, just add the new one
    }

    const nextIntermarc = rewriteManifestationExpressionLinks(manifestation.intermarc, {
      remove: pendingAttach.selectedArks,
      add: pendingAttach.targetExpressionArk,
      partialArk: pendingAttach.partial ? findControlledValueArk('Partiellement') ?? undefined : undefined,
    })
    updateRecordIntermarc(manifestation.id, nextIntermarc)
    setPendingAttach(null)
    setPendingManifestationId(null)
    showToast(
      t('manifestations.uproot.success', {
        defaultValue: 'Manifestation rattachée à la nouvelle expression.',
      }),
      { tone: 'success' },
    )
  }, [findControlledValueArk, getById, pendingAttach, setPendingManifestationId, showToast, t, updateRecordIntermarc])

  return {
    pendingManifestationRecord,
    pendingAttach,
    prepareManifestationForUprooting,
    requestAttachToExpression,
    toggleDetachSelection,
    cancelPendingAttach,
    togglePartial,
    confirmAttach,
  }
}

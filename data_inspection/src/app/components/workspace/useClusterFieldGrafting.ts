import { useCallback, useState } from 'react'
import { toggleClusterFieldGrafting, type DatasetRecordPayload, type WorkspaceUpdatePayload } from '../../lib/api'

type TranslationFn = ReturnType<typeof import('../../hooks/useTranslation')['useTranslation']>['t']

type UseClusterFieldGraftingArgs = {
  datasetId: string | null
  applyServerUpdates: (updates: DatasetRecordPayload[]) => void
  applyServerWorkspaceUpdates: (payload: WorkspaceUpdatePayload) => void
  showToast: (message: string, options?: { tone: 'error' | 'info' | 'success' }) => void
  t: TranslationFn
}

export function useClusterFieldGrafting({
  datasetId,
  applyServerUpdates,
  applyServerWorkspaceUpdates,
  showToast,
  t,
}: UseClusterFieldGraftingArgs) {
  const [busy, setBusy] = useState(false)

  const toggleForAnchor = useCallback(
    async (args: { anchorId: string; appliedBefore: boolean; beforeIntermarc: string }) => {
      if (!datasetId) {
        showToast(t('works.clusterFieldGrafting.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
        throw new Error('Missing dataset')
      }
      if (busy) return
      setBusy(true)
      try {
        const updates = await toggleClusterFieldGrafting(datasetId, { anchorId: args.anchorId })
        applyServerWorkspaceUpdates(updates)
        applyServerUpdates(updates.updatedRecords ?? [])
        const updated = (updates.updatedRecords ?? []).find(r => r.id === args.anchorId) ?? null
        const changed = Boolean(updated?.intermarc && updated.intermarc !== args.beforeIntermarc)
        if (!args.appliedBefore) {
          if (changed) {
            showToast(
              t('works.clusterFieldGrafting.applied', { defaultValue: 'Zones greffées sur l’ancre.' }),
              { tone: 'success' },
            )
          } else {
            showToast(
              t('works.clusterFieldGrafting.noop', { defaultValue: 'Aucune zone à greffer : la notice reste inchangée.' }),
              { tone: 'info' },
            )
          }
        } else {
          showToast(
            t('works.clusterFieldGrafting.removed', { defaultValue: 'Zones greffées retirées.' }),
            { tone: 'success' },
          )
        }
      } catch (error) {
        console.error(error)
        const detail = error instanceof Error ? error.message : null
        showToast(detail || t('works.clusterFieldGrafting.failed', { defaultValue: 'Échec de la greffe.' }), { tone: 'error' })
        throw error
      } finally {
        setBusy(false)
      }
    },
    [applyServerUpdates, applyServerWorkspaceUpdates, busy, datasetId, showToast, t],
  )

  return { toggleClusterFieldGrafting: toggleForAnchor, clusterFieldGraftingBusy: busy }
}

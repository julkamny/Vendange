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
    async (anchorId: string) => {
      if (!datasetId) {
        showToast(t('works.clusterFieldGrafting.noDataset', { defaultValue: 'Aucune base chargée.' }), { tone: 'error' })
        return
      }
      if (busy) return
      setBusy(true)
      try {
        const updates = await toggleClusterFieldGrafting(datasetId, { anchorId })
        applyServerWorkspaceUpdates(updates)
        applyServerUpdates(updates.updatedRecords ?? [])
      } catch (error) {
        console.error(error)
        const detail = error instanceof Error ? error.message : null
        showToast(detail || t('works.clusterFieldGrafting.failed', { defaultValue: 'Échec de la greffe.' }), { tone: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [applyServerUpdates, applyServerWorkspaceUpdates, busy, datasetId, showToast, t],
  )

  return { toggleClusterFieldGrafting: toggleForAnchor, clusterFieldGraftingBusy: busy }
}


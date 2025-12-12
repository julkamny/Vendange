/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Cluster, RecordRow } from '../types'
import type { Intermarc } from '../lib/intermarc'
import { resetArkLabelCache } from '../lib/intermarc'
import { fetchDatasets, syncRecordUpdate, type DatasetSummary, type DatasetRecordPayload, type WorkspaceUpdatePayload } from '../lib/api'
import { useToast } from './ToastContext'
import { getBroadcastClientId, postBroadcastEvent, subscribeToBroadcast } from '../lib/broadcast'

export type AppDataState = {
  datasetId: string | null
  datasetTitle: string | null
  pristineRecords: Map<string, RecordRow>
  clusters: Cluster[]
  loadingDataset: boolean
  originalIndexes: null
}

type AppDataContextValue = AppDataState & {
  loadDataset: (datasetId: string, options?: { title?: string }) => Promise<DatasetSummary>
  refreshDataset: () => Promise<void>
  updateRecordIntermarc: (recordId: string, intermarc: Intermarc) => void
  applyServerUpdates: (_updates: DatasetRecordPayload[]) => void
  applyServerWorkspaceUpdates: (_payload: WorkspaceUpdatePayload) => void
  getCuratedBaselineRecord: (_recordId: string) => null
  setWorkAccepted: (_clusterId: string, _workArk: string, _accepted: boolean) => void
  setExpressionAccepted: (_clusterId: string, _anchorExpressionId: string, _expressionArk: string, _accepted: boolean) => void
  moveManifestation: (
    _clusterId: string,
    _manifestationId: string,
    _target: { anchorExpressionId: string | null; expressionId?: string; expressionArk: string },
  ) => void
  exportCurated: () => Promise<void>
  clearData: () => void
}

const INITIAL_STATE: AppDataState = {
  datasetId: null,
  datasetTitle: null,
  pristineRecords: new Map(),
  clusters: [],
  loadingDataset: false,
  originalIndexes: null,
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast()
  const [state, setState] = useState<AppDataState>(INITIAL_STATE)
  const datasetIdRef = useRef<string | null>(null)
  const queryClient = useQueryClient()
  const clientId = getBroadcastClientId()

  useEffect(() => {
    datasetIdRef.current = state.datasetId
  }, [state.datasetId])

  const loadDataset = useCallback(
    async (datasetId: string, options?: { title?: string }) => {
      setState(prev => ({ ...prev, loadingDataset: true }))
      try {
        const datasets = await fetchDatasets()
        const meta = datasets.find(ds => ds.id === datasetId)
        if (!meta) throw new Error('Dataset not found')
        resetArkLabelCache()
        setState({
          datasetId,
          datasetTitle: options?.title ?? meta.title,
          pristineRecords: new Map(),
          clusters: [],
          loadingDataset: false,
          originalIndexes: null,
        })
        return meta
      } catch (error) {
        console.error('Failed to load dataset', error)
        showToast('Impossible de charger la base sélectionnée.', { tone: 'error' })
        setState(prev => ({ ...prev, loadingDataset: false }))
        throw error
      }
    },
    [showToast],
  )

  const refreshDataset = useCallback(async () => {
    if (!state.datasetId) return
    await loadDataset(state.datasetId, { title: state.datasetTitle ?? undefined })
  }, [loadDataset, state.datasetId, state.datasetTitle])

  useEffect(() => {
    if (!state.datasetId) return undefined
    return subscribeToBroadcast(event => {
      if (event.sourceId === clientId) return
      if (event.type === 'dataset-update' && event.datasetId === state.datasetId) {
        refreshDataset()
      }
    })
  }, [clientId, refreshDataset, state.datasetId])

  const applyServerWorkspaceUpdates = useCallback(
    async (payload: WorkspaceUpdatePayload) => {
      const datasetId = datasetIdRef.current
      if (!datasetId) return
      void payload
      resetArkLabelCache()
      await queryClient.invalidateQueries({
        predicate: query => {
          console.log(query)
          const key = query.queryKey
          return Array.isArray(key) && key[0] === 'workspace' && key[2] === datasetId
        },
      })
    },
    [queryClient],
  )

  const applyServerUpdates = useCallback((updates: DatasetRecordPayload[]) => {
    void updates
  }, [])

  const updateRecordIntermarc = useCallback(
    async (recordId: string, intermarc: Intermarc) => {
      const datasetId = datasetIdRef.current
      if (!datasetId) return
      try {
        const updates = await syncRecordUpdate(datasetId, { id: recordId, type: '', intermarc: JSON.stringify(intermarc) })
        applyServerWorkspaceUpdates(updates)
        applyServerUpdates(updates.updatedRecords ?? [])
        postBroadcastEvent({ type: 'dataset-update', datasetId, recordIds: [recordId] })
      } catch (err) {
        console.error('Failed to synchronise record', err)
        showToast('Synchronisation avec la base impossible.', { tone: 'error' })
      }
    },
    [applyServerUpdates, applyServerWorkspaceUpdates, showToast],
  )

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...state,
      loadDataset,
      refreshDataset,
      updateRecordIntermarc,
      applyServerUpdates,
      applyServerWorkspaceUpdates,
      getCuratedBaselineRecord: () => null,
      setWorkAccepted: () => console.warn('setWorkAccepted deprecated; use backend mutations.'),
      setExpressionAccepted: () => console.warn('setExpressionAccepted deprecated; use backend mutations.'),
      moveManifestation: () => console.warn('moveManifestation deprecated; use backend mutations.'),
      exportCurated: async () => {
        showToast('Export indisponible : les données sont chargées à la demande.', { tone: 'info' })
      },
      clearData: () => {
        resetArkLabelCache()
        setState({ ...INITIAL_STATE, pristineRecords: new Map() })
      },
    }),
    [
      state,
      loadDataset,
      refreshDataset,
      updateRecordIntermarc,
      applyServerUpdates,
      applyServerWorkspaceUpdates,
      showToast,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

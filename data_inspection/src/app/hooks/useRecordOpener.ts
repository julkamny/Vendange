import { useCallback, useRef, type MutableRefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Cluster, RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import { configureTabStateForRecord } from '../workspace/tabState'
import type { WorkspaceDataIndexes } from '../workspace/useWorkspaceData'
import { deriveInternalIdFromArk } from '../lib/ark'
import { fetchWorkspaceRecord } from '../lib/api'
import { buildRecordRowFromPayload } from '../lib/recordPayload'
import { isAgentRecord } from '../agents/useAgentData'

export type WorkspaceContextSnapshot = {
  clusters: Cluster[]
  indexes: WorkspaceDataIndexes
  curatedRecords: RecordRow[]
}

export type RecordOpenOptions = { detach?: boolean }

type Params = {
  datasetId: string | null | undefined
  getWorkspaceContext?: () => WorkspaceContextSnapshot
  cacheRef?: MutableRefObject<Map<string, RecordRow>>
  onOpenWorkspaceTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenWorkspaceDetachedTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentDetachedTab: (initializer: (base: AgentTabState) => AgentTabState) => void
}

export const EMPTY_WORKSPACE_INDEXES: WorkspaceDataIndexes = {
  worksById: new Map(),
  worksByArk: new Map(),
  expressionsById: new Map(),
  expressionsByArk: new Map(),
  expressionsByWorkArk: new Map(),
  manifestationsById: new Map(),
  manifestationsByExpressionArk: new Map(),
}

export function useRecordOpener({
  datasetId,
  getWorkspaceContext,
  cacheRef,
  onOpenWorkspaceTab,
  onOpenWorkspaceDetachedTab,
  onOpenAgentTab,
  onOpenAgentDetachedTab,
}: Params) {
  const queryClient = useQueryClient()
  const fallbackCacheRef = useRef<Map<string, RecordRow>>(new Map())
  const recordCacheRef = cacheRef ?? fallbackCacheRef

  const rememberRecord = useCallback((entry: RecordRow | null) => {
    if (!entry) return
    recordCacheRef.current.set(entry.id, entry)
    if (entry.ark) recordCacheRef.current.set(entry.ark, entry)
  }, [recordCacheRef])

  const getById = useCallback((id: string) => recordCacheRef.current.get(id) ?? null, [recordCacheRef])
  const getByArk = useCallback((ark: string) => recordCacheRef.current.get(ark) ?? null, [recordCacheRef])

  const ensureRecord = useCallback(
    async (key: string | null | undefined) => {
      const trimmed = (key ?? '').trim()
      if (!trimmed) return null
      const cached = recordCacheRef.current.get(trimmed)
      if (cached) return cached
      if (!datasetId) return null
      try {
        const payload = await queryClient.fetchQuery({
          queryKey: ['workspace', 'record', datasetId, trimmed],
          queryFn: () => fetchWorkspaceRecord(datasetId, trimmed),
        })
        const entry = buildRecordRowFromPayload(payload)
        rememberRecord(entry)
        return entry
      } catch (error) {
        console.error('Failed to load record for key', trimmed, error)
        return null
      }
    },
    [datasetId, queryClient, rememberRecord, recordCacheRef],
  )

  const openRecord = useCallback(
    (record: RecordRow, options?: RecordOpenOptions) => {
      if (isAgentRecord(record)) {
        const initializer = (base: AgentTabState) => ({ ...base, selectedAgentId: record.id })
        if (options?.detach) onOpenAgentDetachedTab(initializer)
        else onOpenAgentTab(initializer)
        return
      }

      const ctx =
        getWorkspaceContext?.() ?? {
          clusters: [],
          indexes: EMPTY_WORKSPACE_INDEXES,
          curatedRecords: [record],
        }

      const initializer = (base: WorkspaceTabStateWorkspace) => configureTabStateForRecord(base, record, ctx)
      if (options?.detach) onOpenWorkspaceDetachedTab(initializer)
      else onOpenWorkspaceTab(initializer)
    },
    [getWorkspaceContext, onOpenAgentDetachedTab, onOpenAgentTab, onOpenWorkspaceDetachedTab, onOpenWorkspaceTab],
  )

  const openRecordForArk = useCallback(
    async (ark: string, options?: RecordOpenOptions) => {
      const trimmed = ark.trim()
      if (!trimmed) return null
      let targetRecord = getByArk(trimmed)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmed)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!targetRecord) {
        targetRecord = await ensureRecord(trimmed)
      }
      if (!targetRecord) return null
      openRecord(targetRecord, options)
      return targetRecord
    },
    [ensureRecord, getByArk, getById, openRecord],
  )

  return {
    recordCacheRef,
    getById,
    getByArk,
    rememberRecord,
    ensureRecord,
    openRecord,
    openRecordForArk,
  }
}

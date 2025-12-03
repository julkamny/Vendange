import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RecordRow, Cluster, WorkClusterDto, WorkListRowDto, WorkRecordPayload } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import { WorkListPanel } from '../workspace/components/WorkListPanel'
import { ExpressionPanel } from '../workspace/components/ExpressionPanel'
import { ManifestationPanel } from '../workspace/components/ManifestationPanel'
import { configureTabStateForRecord } from '../workspace/tabState'
import { isAgentRecord } from '../agents/useAgentData'
import { useToast } from '../providers/ToastContext'
import { deriveInternalIdFromArk } from '../lib/ark'
import { useWorkspaceClustering } from './workspace/useWorkspaceClustering'
import { useAnchorSwap } from './workspace/useAnchorSwap'
import { useOriginalitySwap } from './workspace/useOriginalitySwap'
import { useIntermarcSaveGuards } from './workspace/useIntermarcSaveGuards'
import { useWorkspaceInteractions } from './workspace/useWorkspaceInteractions'
import { WorkspaceViewLayout } from './workspace/WorkspaceViewLayout'
import { useWorkspaceBreadcrumbs } from './workspace/useWorkspaceBreadcrumbs'
import { useSelectionMeta } from './workspace/useSelectionMeta'
import { useManifestationUprooting } from './workspace/useManifestationUprooting'
import { extractControlledValueLabel } from '../core/controlledValues'
import { useWorkspaceWorks, useWorkCluster, useWorkspaceRecord } from '../hooks/useWorkspaceQueries'
import { useBacklinks } from '../hooks/useBacklinks'
import { parseIntermarc } from '../lib/intermarc'
import { normalizeType } from '../core/records'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { fetchWorkspaceRecord } from '../lib/api'

function mapManifestation(view: WorkClusterDto['independent_expressions'][number]['manifestations'][number]) {
  return {
    id: view.id,
    ark: view.ark || view.id,
    title: view.title || view.id,
    expressionArk: view.expression_ark || view.original_expression_ark || '',
    expressionId: view.expression_id || undefined,
    originalExpressionArk: view.original_expression_ark || view.expression_ark || '',
    summary: view.summary ?? null,
  }
}

function mapExpression(view: WorkClusterDto['independent_expressions'][number]): import('../types').ExpressionItem {
  const manifestations = (view.manifestations || []).map(mapManifestation)
  return {
    id: view.id,
    ark: view.ark || view.id,
    title: view.title || view.id,
    workArk: view.work_ark || '',
    workId: view.work_id || undefined,
    manifestations,
    summary: view.summary ?? null,
  }
}

function mapExpressionCluster(view: WorkClusterDto['expression_groups'][number]['clustered'][number]) {
  const base = mapExpression(view)
  return {
    ...base,
    anchorExpressionId: view.anchor_expression_id,
    accepted: view.accepted,
    date: view.date || undefined,
    origin: view.origin,
    summary: view.summary ?? base.summary ?? null,
  }
}

function mapWorkCluster(dto: WorkClusterDto): Cluster {
  const expressionGroups = (dto.expression_groups || []).map(group => ({
    anchor: mapExpression(group.anchor),
    clustered: (group.clustered || []).map(mapExpressionCluster),
  }))
  const independentExpressions = (dto.independent_expressions || []).map(mapExpression)
  const anchorSummary = dto.anchor_summary ?? null
  return {
    anchorId: dto.anchor_id,
    anchorArk: dto.anchor_ark || '',
    anchorTitle: dto.anchor_title || dto.anchor_id,
    anchor_summary: anchorSummary,
    anchorSummary,
    items: (dto.items || []).map(item => ({
      ark: item.ark,
      id: item.id || undefined,
      title: item.title || item.id || item.ark,
      accepted: item.accepted,
      date: item.date || undefined,
      origin: item.origin,
      summary: item.summary ?? null,
    })),
    expressionGroups,
    independentExpressions,
  }
}

function buildRecordRowFromPayload(payload: WorkRecordPayload): RecordRow {
  const intermarc = parseIntermarc(payload.intermarc)
  return {
    id: payload.id,
    type: payload.type,
    typeNorm: normalizeType(payload.type),
    ark: payload.ark ?? undefined,
    arkLabels: payload.arkLabels ?? payload.ark_labels ?? {},
    rowIndex: 0,
    intermarcStr: payload.intermarc,
    intermarc,
    raw: [],
  }
}

type WorkspaceViewProps = {
  state: WorkspaceTabStateWorkspace
  onStateChange: (updater: (prev: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenDetachedTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentDetachedTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  mode?: 'inline' | 'detached'
  onRequestDetach?: () => void
  onRequestDock?: () => void
  sharedPendingManifestationId?: string | null
  setSharedPendingManifestationId?: (next: string | null) => void
}

export function WorkspaceView({
  state,
  onStateChange,
  onOpenTab,
  onOpenDetachedTab,
  onOpenAgentTab,
  onOpenAgentDetachedTab,
  mode = 'inline',
  onRequestDetach,
  onRequestDock,
  sharedPendingManifestationId,
  setSharedPendingManifestationId,
}: WorkspaceViewProps) {
  const {
    datasetId,
    updateRecordIntermarc,
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    getCuratedBaselineRecord,
  } = useAppData()
  const { t } = useTranslation()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const recordCacheRef = useRef<Map<string, RecordRow>>(new Map())
  const { data: workspaceWorks } = useWorkspaceWorks(datasetId)
  const anchorLookup = useMemo(() => {
    const map = new Map<string, string>()
    workspaceWorks?.clusters?.forEach(cluster => {
      map.set(cluster.anchor_id, cluster.anchor_id)
      if (cluster.anchor_ark) map.set(cluster.anchor_ark, cluster.anchor_id)
      cluster.items.forEach(item => {
        if (item.ark) map.set(item.ark, cluster.anchor_id)
        if (item.id) map.set(item.id, cluster.anchor_id)
      })
    })
    return map
  }, [workspaceWorks?.clusters])

  const inferredAnchorFromSelection = useMemo(() => {
    const selected = state.selectedEntity
    if (!selected) return null
    const candidates = [
      selected.workArk,
      selected.id,
      selected.expressionArk,
      selected.expressionId,
    ].filter(Boolean) as string[]
    for (const key of candidates) {
      const anchorId = anchorLookup.get(key)
      if (anchorId) return anchorId
    }
    return null
  }, [anchorLookup, state.selectedEntity])

  const activeAnchorKey = useMemo(() => {
    if (state.activeWorkAnchorId) return state.activeWorkAnchorId
    if (inferredAnchorFromSelection) return inferredAnchorFromSelection
    const highlighted = state.highlightedWorkArk ? anchorLookup.get(state.highlightedWorkArk) : null
    if (highlighted) return highlighted
    return state.selectedEntity?.workArk ?? state.highlightedWorkArk ?? null
  }, [anchorLookup, inferredAnchorFromSelection, state.activeWorkAnchorId, state.highlightedWorkArk, state.selectedEntity])
  const { data: activeClusterDto } = useWorkCluster(datasetId, activeAnchorKey)

  const mappedClusters: Cluster[] = useMemo(
    () => (workspaceWorks?.clusters ? workspaceWorks.clusters.map(mapWorkCluster) : []),
    [workspaceWorks?.clusters],
  )
  const coverage = useMemo(() => computeClusterCoverage(mappedClusters), [mappedClusters])
  const unclusteredWorks: WorkListRowDto[] = workspaceWorks?.unclustered_works ?? []

  const recordKey = useMemo(() => {
    const selected = state.selectedEntity
    if (!selected) return null
    return selected.id || selected.workArk || selected.expressionArk || selected.expressionId || selected.id
  }, [state.selectedEntity])
  const { data: recordPayload } = useWorkspaceRecord(datasetId, recordKey)
  const record = useMemo<RecordRow | null>(() => (recordPayload ? buildRecordRowFromPayload(recordPayload) : null), [recordPayload])
  const backlinksQuery = useBacklinks(datasetId, recordKey)

  const rememberRecord = useCallback((entry: RecordRow | null) => {
    if (!entry) return
    recordCacheRef.current.set(entry.id, entry)
    if (entry.ark) recordCacheRef.current.set(entry.ark, entry)
  }, [])

  useEffect(() => {
    rememberRecord(record)
  }, [record, rememberRecord])

  const getById = useCallback((id: string) => recordCacheRef.current.get(id) ?? null, [])
  const getByArk = useCallback((ark: string) => recordCacheRef.current.get(ark) ?? null, [])

  const ensureRecord = useCallback(
    async (key: string | null | undefined) => {
      if (!key) return null
      const cached = recordCacheRef.current.get(key)
      if (cached) return cached
      if (!datasetId) return null
      try {
        const payload = await queryClient.fetchQuery({
          queryKey: ['workspace', 'record', datasetId, key],
          queryFn: () => fetchWorkspaceRecord(datasetId, key),
        })
        const entry = buildRecordRowFromPayload(payload)
        rememberRecord(entry)
        return entry
      } catch (error) {
        console.error('Failed to load record for key', key, error)
        return null
      }
    },
    [datasetId, queryClient, rememberRecord],
  )

  const findControlledValueArk = useCallback(
    (label: string) => {
      const target = record && extractControlledValueLabel(record)?.toLowerCase() === label.trim().toLowerCase() ? record : null
      return target?.ark ?? target?.id ?? null
    },
    [record],
  )
  const backlinks = backlinksQuery.backlinks
  const backlinksLoading = backlinksQuery.isFetching || backlinksQuery.isLoading
  const workspaceContext = useMemo(
    () => ({ clusters: mappedClusters, coverage }),
    [mappedClusters, coverage],
  )
  const { canEditRecord, readOnlyReason } = useSelectionMeta({
    state,
    record,
    workspace: workspaceContext,
    curated: null,
    t,
  })
  const [editingRecord, setEditingRecord] = useState(false)
  const intermarcFullView = state.intermarcFullView
  const backlinksExpanded = state.backlinksExpanded
  const listCollapsed = state.listCollapsed
  const setIntermarcFullView = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) =>
      onStateChange(prev => {
        const resolved = typeof next === 'function' ? next(prev.intermarcFullView) : next
        if (resolved === prev.intermarcFullView) return prev
        return { ...prev, intermarcFullView: resolved }
      }),
    [onStateChange],
  )
  const setBacklinksExpanded = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) =>
      onStateChange(prev => {
        const resolved = typeof next === 'function' ? next(prev.backlinksExpanded) : next
        if (resolved === prev.backlinksExpanded) return prev
        return {
          ...prev,
          backlinksExpanded: resolved,
          intermarcFullView: resolved && prev.intermarcFullView ? false : prev.intermarcFullView,
        }
      }),
    [onStateChange],
  )
  const setListCollapsed = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) =>
      onStateChange(prev => {
        const resolved = typeof next === 'function' ? next(prev.listCollapsed) : next
        if (resolved === prev.listCollapsed) return prev
        return {
          ...prev,
          listCollapsed: resolved,
          intermarcFullView: resolved && prev.intermarcFullView ? false : prev.intermarcFullView,
        }
      }),
    [onStateChange],
  )
  const autoFullRef = useRef<boolean>(false)

  useEffect(() => {
    setEditingRecord(false)
  }, [record?.id, mode])

  useEffect(() => {
    if (mode === 'detached' && !state.intermarcFullView && !autoFullRef.current) {
      autoFullRef.current = true
      onStateChange(prev => (prev.intermarcFullView ? prev : { ...prev, intermarcFullView: true }))
    }
    if (mode === 'inline') {
      autoFullRef.current = false
    }
  }, [mode, state.intermarcFullView, onStateChange])

  const emptyIndexes = useMemo(
    () => ({
      worksById: new Map<string, RecordRow>(),
      worksByArk: new Map<string, RecordRow>(),
      expressionsById: new Map<string, RecordRow>(),
      expressionsByArk: new Map<string, RecordRow>(),
      expressionsByWorkArk: new Map<string, RecordRow[]>(),
      manifestationsById: new Map<string, RecordRow>(),
      manifestationsByExpressionArk: new Map<string, RecordRow[]>(),
    }),
    [],
  )

  const tabContext = useMemo(
    () => ({
      clusters: mappedClusters,
      indexes: emptyIndexes,
      curatedRecords: record ? [record] : [],
    }),
    [mappedClusters, emptyIndexes, record],
  )

  const breadcrumbs = useWorkspaceBreadcrumbs(state, record, id => getById(id) ?? null, ark => getByArk(ark) ?? null)

  const openRecordInWorkspace = useCallback(
    (targetRecord: RecordRow, options?: { detach?: boolean }) => {
      if (isAgentRecord(targetRecord)) {
        const initializer = (base: import('../workspace/types').AgentTabState) => ({
          ...base,
          selectedAgentId: targetRecord.id,
        })
        if (options?.detach) onOpenAgentDetachedTab(initializer)
        else onOpenAgentTab(initializer)
        return
      }
      const initializer = (base: WorkspaceTabStateWorkspace) =>
        configureTabStateForRecord(base, targetRecord, tabContext)
      if (options?.detach) onOpenDetachedTab(initializer)
      else onOpenTab(initializer)
    },
    [onOpenAgentDetachedTab, onOpenAgentTab, onOpenDetachedTab, onOpenTab, tabContext],
  )

  const openRecordForArk = useCallback(
    async (ark: string, options?: { detach?: boolean }) => {
      const trimmed = ark.trim()
      if (!trimmed) return
      let targetRecord = getByArk(trimmed)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmed)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!targetRecord) {
        targetRecord = await ensureRecord(trimmed)
      }
      if (!targetRecord) return
      openRecordInWorkspace(targetRecord, options)
    },
    [ensureRecord, getByArk, getById, openRecordInWorkspace],
  )

  const interactions = useWorkspaceInteractions({
    state,
    onStateChange,
    getById,
    getByArk,
    ensureRecord,
    openRecordForArk,
  })
  const {
    listPanelRef,
    listScrollRef,
    detailsPanelRef,
    contextMenu,
    setContextMenu,
    handleListScroll,
    handleDetailsScroll,
    handleRecordContextMenu,
    handleArkClick,
  } = interactions

  const clustering = useWorkspaceClustering({
    datasetId,
    clusters: mappedClusters,
    getById,
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    showToast,
    t,
    setContextMenu,
  })
  const {
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
  } = clustering

  const {
    getWorkAnchorSwapAction,
    getExpressionAnchorSwapAction,
    pendingWorkAnchorSwapSourceRecord,
    pendingWorkAnchorSwapTarget,
    pendingExpressionAnchorSwapSourceRecord,
    pendingExpressionAnchorSwapTarget,
    confirmWorkAnchorSwap,
    confirmExpressionAnchorSwap,
    cancelWorkAnchorSwap,
    cancelExpressionAnchorSwap,
  } = useAnchorSwap({
    datasetId,
    workClusterIndex,
    expressionClusterIndex,
    getById,
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    showToast,
    t,
    setContextMenu,
  })

  const {
    getOriginalitySwapAction,
    pendingOriginalitySourceRecord,
    pendingOriginalityTarget,
    confirmOriginalitySwap,
    cancelOriginalitySwap,
  } = useOriginalitySwap({
    datasetId,
    clusters: mappedClusters,
    workClusterIndex,
    getById,
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    showToast,
    t,
    setContextMenu,
    findControlledValueArk,
  })

  const handleIntermarcSave = useIntermarcSaveGuards({
    clusters: mappedClusters,
    getByArk,
    getById,
    t,
    updateRecordIntermarc,
    pendingClusterSourceId,
    pendingClusterSourceRecord,
    pendingExpressionClusterSourceId,
    pendingExpressionClusterSourceRecord,
    workClusterIndex,
    expressionClusterIndex,
    getExpressionClusterMembership,
    isProtectedWorkAnchor,
    isProtectedExpressionAnchor,
  })

  const manifestationUprooting = useManifestationUprooting({
    datasetId,
    getById,
    applyServerUpdates,
    applyServerWorkspaceUpdates,
    showToast,
    t,
    setContextMenu,
    findControlledValueArk,
    sharedPendingManifestationId,
    setSharedPendingManifestationId,
  })
  const {
    pendingManifestationRecord,
    pendingAttach,
    prepareManifestationForUprooting,
    requestAttachToExpression,
    toggleDetachSelection,
    togglePartial,
    cancelPendingAttach,
    confirmAttach,
  } = manifestationUprooting

  const activeOperation = useMemo<
    'work-cluster' | 'expression-cluster' | 'anchor-swap' | 'manifestation-uproot' | 'originality-swap' | null
  >(
    () => {
      if (pendingManifestationRecord || pendingAttach) return 'manifestation-uproot'
      if (pendingOriginalitySourceRecord || pendingOriginalityTarget) return 'originality-swap'
      if (
        pendingWorkAnchorSwapSourceRecord ||
        pendingWorkAnchorSwapTarget ||
        pendingExpressionAnchorSwapSourceRecord ||
        pendingExpressionAnchorSwapTarget
      )
        return 'anchor-swap'
      if (pendingClusterSourceRecord || pendingClusterTarget) return 'work-cluster'
      if (pendingExpressionClusterSourceRecord || pendingExpressionClusterTarget) return 'expression-cluster'
      return null
    },
    [
      pendingAttach,
      pendingClusterSourceRecord,
      pendingClusterTarget,
      pendingExpressionAnchorSwapSourceRecord,
      pendingExpressionAnchorSwapTarget,
      pendingExpressionClusterSourceRecord,
      pendingExpressionClusterTarget,
      pendingManifestationRecord,
      pendingOriginalitySourceRecord,
      pendingOriginalityTarget,
      pendingWorkAnchorSwapSourceRecord,
      pendingWorkAnchorSwapTarget,
    ],
  )

  const handleSelectWork = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const cluster =
      workspaceWorks?.clusters.find(entry => entry.anchor_id === workId || entry.anchor_ark === workArk) ?? null
    const nextAnchorId = cluster?.anchor_id ?? workId ?? workArk ?? null
    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: nextAnchorId,
      highlightedWorkArk: workArk ?? null,
      viewMode: 'works',
      listScope: 'clusters',
      selectedEntity: {
        id: workId,
        source: 'curated',
        entityType: 'work',
        workArk: workArk ?? undefined,
      },
    }))
  }

  const handleOpenExpressions = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const cluster = workspaceWorks?.clusters.find(entry => entry.anchor_id === workId || entry.anchor_ark === workArk) ?? null
    const nextAnchorId = cluster?.anchor_id ?? workId ?? workArk ?? null
    if (cluster) {
      onStateChange(prev => ({
        ...prev,
        activeWorkAnchorId: nextAnchorId,
        highlightedWorkArk: workArk ?? null,
        viewMode: 'expressions',
        listScope: 'clusters',
        selectedEntity: {
          id: workId,
          source: 'curated',
          entityType: 'work',
          workArk: workArk ?? undefined,
        },
      }))
      return
    }

    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: nextAnchorId,
      highlightedWorkArk: workArk ?? null,
      viewMode: 'expressions',
      listScope: 'clusters',
      selectedEntity: {
        id: workId,
        source: 'curated',
        entityType: 'work',
        workArk: workArk ?? undefined,
      },
    }))

  }

  const renderListPanel = (viewMode: WorkspaceTabStateWorkspace['viewMode']) => {
    if (viewMode === 'works') {
      return (
        <WorkListPanel
          clusters={workspaceWorks?.clusters ?? []}
          unclusteredWorks={unclusteredWorks}
          state={state}
          onSelectWork={handleSelectWork}
          onOpenExpressions={handleOpenExpressions}
          onToggleWork={({ clusterId, workArk, workId, accepted }) =>
            toggleWorkClusterMembership({ clusterId, workArk, workId, accepted })
          }
          pendingClusterSourceId={pendingClusterSourceId}
          onCancelPendingCluster={cancelPendingCluster}
          listRef={listScrollRef}
          onScroll={handleListScroll}
        />
      )
    }
    if (viewMode === 'expressions') {
      return (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onScroll={handleListScroll}>
          <ExpressionPanel
            cluster={activeClusterDto ?? null}
            state={state}
            onSelectExpression={({
              expressionId,
              expressionArk,
              workArk,
              anchorId,
            }: {
              expressionId: string
              expressionArk?: string
              workArk?: string
              anchorId?: string
            }) =>
              onStateChange(prev => {
                return {
                  ...prev,
                  viewMode: 'expressions',
                  listScope: 'clusters',
                  activeExpressionAnchorId: anchorId ?? expressionId ?? null,
                  highlightedExpressionArk: expressionArk ?? null,
                  selectedEntity: {
                    id: expressionId,
                    source: 'curated',
                    entityType: 'expression',
                    workArk: workArk ?? undefined,
                    expressionId,
                    expressionArk,
                  },
                }
              })
            }
            onToggleExpression={({ anchorExpressionId, expressionArk, expressionId, accepted }) => {
              if (!activeClusterDto) return
              toggleExpressionClusterMembership({
                anchorExpressionId,
                expressionArk,
                expressionId,
                accepted,
              })
            }}
            onOpenManifestations={({ expressionId, expressionArk, workArk, anchorId }) => {
              onStateChange(prev => {
                return {
                  ...prev,
                  viewMode: 'manifestations',
                  listScope: 'clusters',
                  activeExpressionAnchorId: anchorId ?? expressionId ?? null,
                  highlightedExpressionArk: expressionArk ?? null,
                  selectedEntity: {
                    id: expressionId,
                    source: 'curated',
                    entityType: 'expression',
                    workArk: workArk ?? undefined,
                    expressionId,
                    expressionArk,
                  },
                }
              })
            }}
            pendingClusterSourceId={pendingExpressionClusterSourceId}
            onCancelPendingCluster={cancelPendingExpressionCluster}
          />
        </div>
      )
    }
    return (
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }} onScroll={handleListScroll}>
        <ManifestationPanel
          cluster={activeClusterDto ?? null}
          state={state}
          pendingManifestationId={pendingManifestationRecord?.id ?? null}
          onSelectManifestation={({
            manifestationId,
            expressionId,
            expressionArk,
          }: {
            manifestationId: string
            expressionId?: string
            expressionArk?: string
          }) =>
            onStateChange(prev => ({
              ...prev,
              viewMode: 'manifestations',
              selectedEntity: {
                id: manifestationId,
                source: 'curated',
                entityType: 'manifestation',
                expressionId,
                expressionArk,
              },
            }))
          }
        />
      </div>
    )
  }

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${backlinksExpanded && record ? ' has-backlinks-expanded' : ''}${listCollapsed ? ' is-list-collapsed' : ''}`
  const detachLabelFull = t('workspace.openInWindow', { defaultValue: 'Open Intermarc in new window' })
  const dockLabelFull = t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })
  const toggleFullLabelFull = intermarcFullView
    ? t('workspace.collapseIntermarc', { defaultValue: 'Exit full Intermarc view' })
    : t('workspace.expandIntermarc', { defaultValue: 'Expand Intermarc view' })

  return (
    <WorkspaceViewLayout
      mode={mode}
      state={state}
      workspaceClassName={workspaceClassName}
       activeOperation={activeOperation}
      breadcrumbs={breadcrumbs}
      record={record}
      getById={getById}
      getByArk={getByArk}
      renderListPanel={renderListPanel}
      listPanelRef={listPanelRef}
      detailsPanelRef={detailsPanelRef}
      handleListScroll={handleListScroll}
      handleDetailsScroll={handleDetailsScroll}
      handleRecordContextMenu={handleRecordContextMenu}
      handleArkClick={handleArkClick}
      handleIntermarcSave={handleIntermarcSave}
      editingRecord={editingRecord}
      setEditingRecord={setEditingRecord}
      canEditRecord={canEditRecord}
      readOnlyReason={readOnlyReason}
      backlinks={backlinks}
      backlinksLoading={backlinksLoading}
      openRecordForArk={openRecordForArk}
      getCuratedBaselineRecord={getCuratedBaselineRecord}
      listCollapsed={listCollapsed}
      intermarcFullView={intermarcFullView}
      backlinksExpanded={backlinksExpanded}
      setIntermarcFullView={setIntermarcFullView}
      setListCollapsed={setListCollapsed}
      setBacklinksExpanded={setBacklinksExpanded}
      onRequestDetach={onRequestDetach}
      onRequestDock={onRequestDock}
      detachLabelFull={detachLabelFull}
      dockLabelFull={dockLabelFull}
      toggleFullLabelFull={toggleFullLabelFull}
      toolbarAriaLabel={t('workspace.sidebarActions', { defaultValue: 'Workspace actions' })}
      listShowLabel={t('workspace.showList', { defaultValue: 'Show list' })}
      listHideLabel={t('workspace.hideList', { defaultValue: 'Hide list' })}
      backlinksShowLabel={t('backlinks.show', { defaultValue: 'Expand backlinks' })}
      backlinksHideLabel={t('backlinks.hide', { defaultValue: 'Fold backlinks' })}
      selectPrompt={t('layout.selectPrompt')}
      openTabLabel={t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })}
      openDetachedLabel={t('workspace.openInDetachedWindow', { defaultValue: 'Open in detached workspace window' })}
      prepareWorkLabel={t('works.cluster.prepare', { defaultValue: 'Préparer pour clustering' })}
      clusterWorkLabel={t('works.cluster.clusterWith', { defaultValue: 'Clustériser avec la sélection' })}
      prepareExpressionLabel={t('expressions.cluster.prepare', { defaultValue: 'Préparer pour clustering' })}
      clusterExpressionLabel={t('expressions.cluster.clusterWith', { defaultValue: 'Clustériser avec la sélection' })}
      prepareUprootLabel={t('manifestations.uproot.prepareAction', { defaultValue: 'Prepare for uprooting' })}
      attachManifestationLabel={t('manifestations.uproot.attachHere', {
        defaultValue: 'Attach selected manifestation to this expression',
      })}
      backlinksTitle={t('backlinks.title', { defaultValue: 'Backlinks' })}
      contextMenu={contextMenu}
      setContextMenu={setContextMenu}
      pendingClusterSourceRecord={pendingClusterSourceRecord}
      pendingClusterTarget={pendingClusterTarget}
      confirmPendingCluster={confirmPendingCluster}
      cancelPendingCluster={cancelPendingCluster}
      pendingExpressionClusterSourceRecord={pendingExpressionClusterSourceRecord}
      pendingExpressionClusterTarget={pendingExpressionClusterTarget}
      confirmPendingExpressionCluster={confirmPendingExpressionCluster}
      cancelPendingExpressionCluster={cancelPendingExpressionCluster}
      prepareForClustering={prepareForClustering}
      requestClusterWith={requestClusterWith}
      prepareExpressionForClustering={prepareExpressionForClustering}
      requestExpressionClusterWith={requestExpressionClusterWith}
      getWorkAnchorSwapAction={getWorkAnchorSwapAction}
      getExpressionAnchorSwapAction={getExpressionAnchorSwapAction}
      getOriginalitySwapAction={getOriginalitySwapAction}
      pendingWorkAnchorSwapSourceRecord={pendingWorkAnchorSwapSourceRecord}
      pendingWorkAnchorSwapTarget={pendingWorkAnchorSwapTarget}
      pendingExpressionAnchorSwapSourceRecord={pendingExpressionAnchorSwapSourceRecord}
      pendingExpressionAnchorSwapTarget={pendingExpressionAnchorSwapTarget}
      pendingOriginalitySourceRecord={pendingOriginalitySourceRecord}
      pendingOriginalityTarget={pendingOriginalityTarget}
      confirmPendingOriginalitySwap={confirmOriginalitySwap}
      cancelPendingOriginalitySwap={cancelOriginalitySwap}
      confirmPendingWorkAnchorSwap={confirmWorkAnchorSwap}
      cancelPendingWorkAnchorSwap={cancelWorkAnchorSwap}
      confirmPendingExpressionAnchorSwap={confirmExpressionAnchorSwap}
      cancelPendingExpressionAnchorSwap={cancelExpressionAnchorSwap}
      pendingManifestationRecord={pendingManifestationRecord}
      pendingManifestationAttach={pendingAttach}
      prepareManifestationForUprooting={prepareManifestationForUprooting}
      requestAttachToExpression={requestAttachToExpression}
      toggleDetachSelection={toggleDetachSelection}
      togglePartialAttach={togglePartial}
      cancelPendingAttach={cancelPendingAttach}
      confirmAttach={confirmAttach}
      setBacklinksExpandedLabel={t('backlinks.show', { defaultValue: 'Backlinks' })}
    />
  )
}

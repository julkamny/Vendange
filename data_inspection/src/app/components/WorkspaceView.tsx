import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecordRow, Cluster, WorkListRowDto } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState, ArkFilterSource } from '../workspace/types'
import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import { WorkListPanel } from '../workspace/components/WorkListPanel'
import { ExpressionPanel } from '../workspace/components/ExpressionPanel'
import { ManifestationPanel } from '../workspace/components/ManifestationPanel'
import { useToast } from '../providers/ToastContext'
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
import { buildRecordRowFromPayload } from '../lib/recordPayload'
import { computeClusterCoverage } from '../core/clusterCoverage'
import { mapWorkCluster } from '../lib/mapWorkClusters'
import { useRecordOpener } from '../hooks/useRecordOpener'
import { buildArkAndIdSets } from '../lib/arkFilters'
import { filterNavigationTargets, pickCyclicMatch, type NavigationTarget } from '../lib/filterNavigation'
import type { NavigationDirection } from '../types'

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
  workArkFilter?: string[] | null
  workArkFilterSource?: ArkFilterSource | null
  onClearWorkArkFilter?: () => void
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
  workArkFilter,
  workArkFilterSource,
  onClearWorkArkFilter,
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
  const unclusteredWorks: WorkListRowDto[] = useMemo(
    () => workspaceWorks?.unclustered_works ?? [],
    [workspaceWorks?.unclustered_works],
  )
  const { ids: workFilterIdSet } = useMemo(
    () => buildArkAndIdSets(workArkFilter ?? null),
    [workArkFilter],
  )
  const workNavigationCandidates = useMemo<NavigationTarget[]>(() => {
    const candidates: NavigationTarget[] = []
    const clusters = workspaceWorks?.clusters ?? []
    clusters.forEach((cluster, clusterIndex) => {
      candidates.push({
        id: cluster.anchor_id,
        ark: cluster.anchor_ark ?? null,
        anchorId: cluster.anchor_id,
        containerIndex: clusterIndex,
      })
      cluster.items.forEach(item => {
        if (item.id == null) return
        candidates.push({
          id: String(item.id),
          ark: item.ark,
          anchorId: cluster.anchor_id,
          containerIndex: clusterIndex,
        })
      })
    })
    const offset = clusters.length
    unclusteredWorks.forEach((work, index) => {
      candidates.push({
        id: work.id,
        ark: work.ark ?? null,
        anchorId: null,
        containerIndex: offset + index,
      })
    })
    return candidates
  }, [unclusteredWorks, workspaceWorks?.clusters])
  const filteredWorkMatches = useMemo(
    () => filterNavigationTargets(workNavigationCandidates, workFilterIdSet),
    [workNavigationCandidates, workFilterIdSet],
  )
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

  const recordKey = useMemo(() => {
    const selected = state.selectedEntity
    if (!selected) return null
    return selected.id || selected.workArk || selected.expressionArk || selected.expressionId || selected.id
  }, [state.selectedEntity])
  const { data: recordPayload } = useWorkspaceRecord(datasetId, recordKey)
  const record = useMemo<RecordRow | null>(() => (recordPayload ? buildRecordRowFromPayload(recordPayload) : null), [recordPayload])
  const backlinksQuery = useBacklinks(datasetId, recordKey)
  const getWorkspaceContext = useCallback(
    () => ({
      clusters: mappedClusters,
      indexes: emptyIndexes,
      curatedRecords: Array.from(recordCacheRef.current.values()),
    }),
    [emptyIndexes, mappedClusters],
  )
  const { getById, getByArk, ensureRecord, rememberRecord, openRecordForArk } = useRecordOpener({
    datasetId,
    getWorkspaceContext,
    cacheRef: recordCacheRef,
    onOpenWorkspaceTab: onOpenTab,
    onOpenWorkspaceDetachedTab: onOpenDetachedTab,
    onOpenAgentTab,
    onOpenAgentDetachedTab,
  })

  useEffect(() => {
    if (record) rememberRecord(record)
  }, [record, rememberRecord])

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
    if (mode === 'detached' && !autoFullRef.current) {
      autoFullRef.current = true
      onStateChange(prev => {
        if (prev.intermarcFullView && prev.listCollapsed && !prev.backlinksExpanded) return prev
        return { ...prev, intermarcFullView: true, listCollapsed: true, backlinksExpanded: false }
      })
    }
    if (mode === 'inline') {
      autoFullRef.current = false
    }
  }, [mode, onStateChange])

  const breadcrumbs = useWorkspaceBreadcrumbs(state, record, id => getById(id) ?? null, ark => getByArk(ark) ?? null)

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
      highlightedWorkId: workId ?? null,
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
        highlightedWorkId: workId ?? null,
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
      highlightedWorkId: workId ?? null,
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

  const focusFilteredWork = useCallback(
    (direction: NavigationDirection) => {
      const currentWorkId =
        state.highlightedWorkId ??
        (state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null)
      const target = pickCyclicMatch(filteredWorkMatches, currentWorkId, direction)
      if (!target) return
      onStateChange(prev => ({
        ...prev,
        viewMode: 'works',
        listScope: 'clusters',
        activeWorkAnchorId: target.anchorId ?? target.id ?? prev.activeWorkAnchorId,
        highlightedWorkId: target.id,
        highlightedWorkArk: target.ark ?? prev.highlightedWorkArk ?? null,
        selectedEntity: {
          id: target.id,
          source: 'curated',
          entityType: 'work',
          workArk: target.ark ?? undefined,
        },
      }))
    },
    [filteredWorkMatches, onStateChange, state.highlightedWorkId, state.selectedEntity],
  )

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
          workArkFilter={workArkFilter ?? null}
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
  const dockLabelFull =
    mode === 'detached'
      ? t('workspace.redockTabMainApp', { defaultValue: "Ramener l'onglet dans l'application centrale" })
      : t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })
  const toggleFullLabelFull = intermarcFullView
    ? t('workspace.collapseIntermarc', { defaultValue: 'Exit full Intermarc view' })
    : t('workspace.expandIntermarc', { defaultValue: 'Expand Intermarc view' })

  const workFilterBanner =
    workArkFilter && workArkFilter.length
      ? (
        <div className="workspace-filter-banner">
          <div className="workspace-filter-banner__info">
            <strong>
              {t('workspace.workArkFilterActive', { defaultValue: 'Filtered by SPARQL subset' })}
            </strong>
            <span>
              {t('workspace.workArkFilterCount', {
                defaultValue: '{{count}} work ARKs in scope',
                count: workArkFilter.length,
              })}
            </span>
            {workArkFilterSource ? (
              <span className="workspace-filter-banner__source">
                {t('workspace.workArkFilterSource', {
                  defaultValue: "Source: '{{title}}' – {{columns}}",
                  title: workArkFilterSource.tabTitle,
                  columns: workArkFilterSource.workColumns.join(', '),
                })}
              </span>
            ) : null}
          </div>
          <div className="workspace-filter-banner__actions">
            {onClearWorkArkFilter ? (
              <button type="button" onClick={onClearWorkArkFilter}>
                {t('workspace.clearWorkFilter', { defaultValue: 'Clear work filter' })}
              </button>
            ) : null}
            <div className="workspace-filter-banner__nav">
              <button
                type="button"
                onClick={() => focusFilteredWork('next')}
                disabled={!filteredWorkMatches.length}
              >
                {t('workspace.nextFilteredWork', { defaultValue: 'Next filtered work' })}
              </button>
              <button
                type="button"
                onClick={() => focusFilteredWork('previous')}
                disabled={!filteredWorkMatches.length}
              >
                {t('workspace.previousFilteredWork', { defaultValue: 'Previous filtered work' })}
              </button>
            </div>
          </div>
        </div>
      )
      : null

  return (
    <WorkspaceViewLayout
      mode={mode}
      state={state}
      workspaceClassName={workspaceClassName}
       activeOperation={activeOperation}
      headerBanner={workFilterBanner}
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

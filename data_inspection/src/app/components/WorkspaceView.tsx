import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { WorkListPanel } from '../workspace/components/WorkListPanel'
import { ExpressionPanel } from '../workspace/components/ExpressionPanel'
import { ManifestationPanel } from '../workspace/components/ManifestationPanel'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { configureTabStateForRecord } from '../workspace/tabState'
import { useBacklinks } from '../hooks/useBacklinks'
import { isAgentRecord } from '../agents/useAgentData'
import { useToast } from '../providers/ToastContext'
import { deriveInternalIdFromArk } from '../lib/ark'
import { useWorkspaceClustering } from './workspace/useWorkspaceClustering'
import { useIntermarcSaveGuards } from './workspace/useIntermarcSaveGuards'
import { useWorkspaceInteractions } from './workspace/useWorkspaceInteractions'
import { WorkspaceViewLayout } from './workspace/WorkspaceViewLayout'
import { useWorkspaceBreadcrumbs } from './workspace/useWorkspaceBreadcrumbs'
import { useSelectionMeta } from './workspace/useSelectionMeta'

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
}

function findRecord(id: string, curated: RecordRow[]): RecordRow | null {
  return curated.find(rec => rec.id === id) || null
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
}: WorkspaceViewProps) {
  const {
    clusters,
    curated,
    setWorkAccepted,
    setExpressionAccepted,
    updateRecordIntermarc,
    getCuratedBaselineRecord,
  } = useAppData()
  const workspace = useWorkspaceData(state)
  const { t } = useTranslation()
  const { getById, getByArk } = useRecordLookup()
  const { getBacklinksForRecord } = useBacklinks()
  const { showToast } = useToast()
  const record = state.selectedEntity
    ? findRecord(state.selectedEntity.id, curated?.records ?? [])
    : null
  const backlinks = useMemo(
    () => (record ? getBacklinksForRecord(record) : []),
    [getBacklinksForRecord, record],
  )
  const { canEditRecord, readOnlyReason } = useSelectionMeta({ state, record, workspace, curated, t })
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

  const tabContext = useMemo(
    () => ({
      clusters,
      indexes: workspace.indexes,
      curatedRecords: curated?.records ?? [],
    }),
    [clusters, workspace.indexes, curated?.records],
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
    (ark: string, options?: { detach?: boolean }) => {
      const trimmed = ark.trim()
      if (!trimmed) return
      let targetRecord = getByArk(trimmed)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmed)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!targetRecord) return
      openRecordInWorkspace(targetRecord, options)
    },
    [getByArk, getById, openRecordInWorkspace],
  )

  const interactions = useWorkspaceInteractions({
    state,
    onStateChange,
    getById,
    getByArk,
    openRecordForArk,
  })
  const {
    listPanelRef,
    detailsPanelRef,
    contextMenu,
    setContextMenu,
    handleListScroll,
    handleDetailsScroll,
    handleRecordContextMenu,
    handleArkClick,
  } = interactions

  const clustering = useWorkspaceClustering({
    clusters,
    getById,
    updateRecordIntermarc,
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
    workClusterIndex,
  } = clustering

  const handleIntermarcSave = useIntermarcSaveGuards({
    clusters,
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

  const handleSelectWork = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const cluster = workspace.clusters.find(entry => entry.anchorId === workId) ?? null
    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: cluster?.anchorId ?? null,
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
    const cluster = workspace.clusters.find(entry => entry.anchorId === workId) ?? null
    if (cluster) {
      onStateChange(prev => ({
        ...prev,
        activeWorkAnchorId: cluster.anchorId,
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
      activeWorkAnchorId: null,
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
          clusters={workspace.clusters}
          unclusteredWorks={workspace.unclusteredWorks}
          state={state}
          onSelectWork={handleSelectWork}
          onOpenExpressions={handleOpenExpressions}
          onToggleWork={({ clusterId, workArk, accepted }) => setWorkAccepted(clusterId, workArk, accepted)}
          pendingClusterSourceId={pendingClusterSourceId}
          onCancelPendingCluster={cancelPendingCluster}
        />
      )
    }
    if (viewMode === 'expressions') {
      return (
        <ExpressionPanel
          cluster={workspace.activeCluster}
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
          onToggleExpression={({ anchorExpressionId, expressionArk, accepted }) => {
            if (!workspace.activeCluster || workspace.activeClusterSource !== 'cluster') return
            setExpressionAccepted(workspace.activeCluster.anchorId, anchorExpressionId, expressionArk, accepted)
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
      )
    }
    return (
      <ManifestationPanel
        cluster={workspace.activeCluster}
        state={state}
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
      breadcrumbs={breadcrumbs}
      record={record}
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
      openRecordForArk={openRecordForArk}
      getCuratedBaselineRecord={getCuratedBaselineRecord}
      lookupWorkByArk={getByArk}
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
      setBacklinksExpandedLabel={t('backlinks.show', { defaultValue: 'Backlinks' })}
    />
  )
}

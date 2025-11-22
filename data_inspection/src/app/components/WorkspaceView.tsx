import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { RecordRow } from '../types'
import type { WorkspaceTabStateWorkspace, AgentTabState } from '../workspace/types'
import { useAppData } from '../providers/AppDataContext'
import { useTranslation } from '../hooks/useTranslation'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { WorkListPanel } from '../workspace/components/WorkListPanel'
import { ExpressionPanel } from '../workspace/components/ExpressionPanel'
import { ManifestationPanel } from '../workspace/components/ManifestationPanel'
import { IntermarcView } from './IntermarcView'
import { IntermarcEditor } from './IntermarcEditor'
import { isWorkClustered, isExpressionClustered, isManifestationClustered } from '../core/clusterCoverage'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { expressionWorkArks, manifestationTitle, titleOf } from '../core/entities'
import { configureTabStateForRecord } from '../workspace/tabState'
import { deriveInternalIdFromArk } from '../lib/ark'
import { BacklinksPanel } from './BacklinksPanel'
import { useBacklinks } from '../hooks/useBacklinks'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { isAgentRecord } from '../agents/useAgentData'
import { useToast } from '../providers/ToastContext'
import { WorkspaceBreadcrumbs } from './workspace/WorkspaceBreadcrumbs'
import { ConfirmExpressionClusterModal, ConfirmWorkClusterModal } from './workspace/ClusterModals'
import { useWorkspaceClustering } from './workspace/useWorkspaceClustering'
import { useIntermarcSaveGuards } from './workspace/useIntermarcSaveGuards'
import type { WorkspaceContextMenuState } from './workspace/types'

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

function isNavigableRecord(record: RecordRow | undefined): record is RecordRow {
  if (!record) return false
  if (record.typeNorm === 'oeuvre' || record.typeNorm === 'expression' || record.typeNorm === 'manifestation') return true
  return isAgentRecord(record)
}

type WorkspaceContextMenuState = {
  position: { x: number; y: number }
  record: RecordRow
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
  const recordInCurated = useMemo(() => {
    if (!record || !curated) return false
    return curated.records.some(r => r.id === record.id)
  }, [record, curated])
  const isAnchorSelection = useMemo(() => {
    const selected = state.selectedEntity
    if (!selected) return false

    if (selected.entityType === 'work') {
      const targetArk = selected.workArk ?? record?.ark ?? null
      return workspace.clusters.some(cluster => {
        if (cluster.anchorId === selected.id) return true
        if (targetArk && cluster.anchorArk === targetArk) return true
        return false
      })
    }

    if (selected.entityType === 'expression') {
      const targetId = selected.expressionId ?? selected.id
      const targetArk = selected.expressionArk ?? record?.ark ?? null
      return workspace.clusters.some(cluster =>
        cluster.expressionGroups.some(group => {
          if (group.anchor.id === targetId) return true
          if (targetArk && group.anchor.ark === targetArk) return true
          return false
        }),
      )
    }

    if (selected.entityType === 'manifestation') {
      const targetId = selected.id
      const targetArk = record?.ark ?? null
      return workspace.clusters.some(cluster =>
        cluster.expressionGroups.some(group =>
          group.anchor.manifestations.some(item => item.id === targetId || (targetArk && item.ark === targetArk)),
        ),
      )
    }

    return false
  }, [record, state.selectedEntity, workspace.clusters])
  const isRecordClustered = useMemo(() => {
    if (!record) return false
    switch (record.typeNorm) {
      case 'oeuvre':
        return isWorkClustered(record, workspace.coverage)
      case 'expression':
        return isExpressionClustered(record, workspace.coverage)
      case 'manifestation':
        return isManifestationClustered(record, workspace.coverage)
      default:
        return false
    }
  }, [record, workspace.coverage])
  const canEditRecord = useMemo(() => {
    if (!record || !recordInCurated) return false
    if (record.typeNorm === 'manifestation') return true
    if (!isRecordClustered) return true
    return isAnchorSelection
  }, [isAnchorSelection, isRecordClustered, record, recordInCurated])
  const readOnlyReason = useMemo(() => {
    if (!record) return null
    if (!recordInCurated) return t('messages.recordNotInCurated')
    if (record.typeNorm !== 'manifestation' && isRecordClustered && !isAnchorSelection)
      return t('messages.clusteredRecordReadOnly')
    return null
  }, [isAnchorSelection, isRecordClustered, record, recordInCurated, t])
  const [editingRecord, setEditingRecord] = useState(false)
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
  const listPanelRef = useRef<HTMLElement | null>(null)
  const detailsPanelRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
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

  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenuState | null>(null)

  const tabContext = useMemo(
    () => ({
      clusters,
      indexes: workspace.indexes,
      curatedRecords: curated?.records ?? [],
    }),
    [clusters, workspace.indexes, curated?.records],
  )

  const breadcrumbs = useMemo(() => {
    const items: string[] = []

    const addLabel = (value?: string | null) => {
      if (!value) return
      const trimmed = value.trim()
      if (!trimmed) return
      if (items[items.length - 1] === trimmed) return
      items.push(trimmed)
    }

    const labelFromRecord = (rec?: RecordRow | null, fallback?: string) => {
      if (!rec) return fallback
      if (rec.typeNorm === 'manifestation') {
        return manifestationTitle(rec) || rec.id
      }
      return titleOf(rec) || rec.id
    }

    const selected = state.selectedEntity
    if (!selected) return items

    if (selected.entityType === 'work') {
      const workRecord = getById(selected.id) || getByArk(selected.workArk)
      addLabel(labelFromRecord(workRecord, selected.id))
      return items
    }

    if (selected.entityType === 'expression') {
      const workRecord = selected.workArk ? getByArk(selected.workArk) : undefined
      if (workRecord) addLabel(labelFromRecord(workRecord, workRecord.id))
      else if (selected.workArk) addLabel(selected.workArk)
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getById(selected.id) ||
        getByArk(selected.expressionArk)
      addLabel(labelFromRecord(expressionRecord, selected.expressionId || selected.id))
      return items
    }

    if (selected.entityType === 'manifestation') {
      const expressionRecord =
        (selected.expressionId && getById(selected.expressionId)) ||
        getByArk(selected.expressionArk)
      if (expressionRecord) {
        const relatedWorkArk = selected.workArk || expressionWorkArks(expressionRecord)[0]
        if (relatedWorkArk) {
          const workRecord = getByArk(relatedWorkArk)
          addLabel(labelFromRecord(workRecord, relatedWorkArk))
        }
        addLabel(labelFromRecord(expressionRecord, expressionRecord.id))
      }
      const manifestationRecord = record || getById(selected.id) || getByArk(selected.id)
      addLabel(labelFromRecord(manifestationRecord, selected.id))
      return items
    }

    addLabel(selected.id)
    return items
  }, [
    getByArk,
    getById,
    record,
    state.selectedEntity,
  ])

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), [])

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

  useLayoutEffect(() => {
    const listNode = listPanelRef.current
    if (!listNode) return
    if (Math.abs(listNode.scrollTop - state.listScrollTop) > 1) {
      listNode.scrollTop = state.listScrollTop
    }
  }, [state.listScrollTop])

  useLayoutEffect(() => {
    const detailsNode = detailsPanelRef.current
    if (!detailsNode) return
    if (Math.abs(detailsNode.scrollTop - state.detailsScrollTop) > 1) {
      detailsNode.scrollTop = state.detailsScrollTop
    }
  }, [state.detailsScrollTop])

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const target = event.currentTarget
      const next = target.scrollTop
      onStateChange(prev => (Math.abs(prev.listScrollTop - next) < 0.5 ? prev : { ...prev, listScrollTop: next }))
    },
    [onStateChange],
  )

  const handleDetailsScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const target = event.currentTarget
      const next = target.scrollTop
      onStateChange(prev => (Math.abs(prev.detailsScrollTop - next) < 0.5 ? prev : { ...prev, detailsScrollTop: next }))
    },
    [onStateChange],
  )

  const scrollHighlightedEntityIntoView = useCallback(() => {
    if (typeof window === 'undefined') return
    const container = listPanelRef.current
    if (!container) return
    window.requestAnimationFrame(() => {
      const target =
        container.querySelector<HTMLElement>('.entity-row.selected') ||
        container.querySelector<HTMLElement>('.entity-row.highlight') ||
        container.querySelector<HTMLElement>('.manifestation-section.highlight')
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [])

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.workspace-context-menu')) return
      if (target.closest('.ark-link')) return
      if (target.closest('.entity-row')) return
      handleCloseContextMenu()
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseContextMenu()
      }
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [contextMenu, handleCloseContextMenu])

  useEffect(() => {
    const selectedKey = state.selectedEntity ? `${state.selectedEntity.entityType}:${state.selectedEntity.id}` : ''
    const key = `${state.viewMode}|${state.listScope}|${selectedKey}|${state.highlightedWorkArk ?? ''}|${state.highlightedExpressionArk ?? ''}`
    if (lastScrollKeyRef.current === key) return
    lastScrollKeyRef.current = key
    scrollHighlightedEntityIntoView()
  }, [
    scrollHighlightedEntityIntoView,
    state.highlightedExpressionArk,
    state.highlightedWorkArk,
    state.listScope,
    state.selectedEntity,
    state.selectedEntity?.entityType,
    state.selectedEntity?.id,
    state.viewMode,
  ])

  const resolveRecordFromRow = useCallback(
    (row: HTMLElement): RecordRow | null => {
      if (row.classList.contains('entity-row--work')) {
        const workId = row.dataset.workId
        const workArk = row.dataset.workArk
        const record = (workId ? getById(workId) : undefined) ?? (workArk ? getByArk(workArk) : undefined)
        return isNavigableRecord(record) ? record : null
      }
      if (row.classList.contains('entity-row--expression')) {
        const expressionId = row.dataset.expressionId
        const expressionArk = row.dataset.expressionArk
        const record =
          (expressionId ? getById(expressionId) : undefined) ??
          (expressionArk ? getByArk(expressionArk) : undefined)
        return isNavigableRecord(record) ? record : null
      }
      if (row.classList.contains('entity-row--manifestation')) {
        const manifestationId = row.dataset.manifestationId
        const record = manifestationId ? getById(manifestationId) ?? getByArk(manifestationId) : undefined
        return isNavigableRecord(record) ? record : null
      }
      return null
    },
    [getByArk, getById],
  )

  const handleRecordContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const rawArk = arkLink.getAttribute('data-ark')
      if (!rawArk) return
      const trimmedArk = rawArk.trim()
      if (!trimmedArk) return
      let targetRecord = getByArk(trimmedArk)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmedArk)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!isNavigableRecord(targetRecord)) return
      event.preventDefault()
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        record: targetRecord,
      })
    },
    [getByArk, getById],
  )

  useEffect(() => {
    const listNode = listPanelRef.current
    if (!listNode) return undefined
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const row = target?.closest<HTMLElement>('.entity-row')
      if (!row) return
      const record = resolveRecordFromRow(row)
      if (!record) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        record,
      })
    }
    listNode.addEventListener('contextmenu', handleContextMenu)
    return () => listNode.removeEventListener('contextmenu', handleContextMenu)
  }, [resolveRecordFromRow])

  const handleArkClick = useCallback(
    (ark: string, context: { zone: string; subfield: string }) => {
      const zone = context.zone?.trim()
      if (!zone) return
      if (zone === '140' || zone === '750' || zone === '740' || zone === '540') {
        openRecordForArk(ark)
      }
    },
    [openRecordForArk],
  )

  const handleOpenRecordInNewTab = useCallback(() => {
    if (!contextMenu) return
    openRecordInWorkspace(contextMenu.record)
    setContextMenu(null)
  }, [contextMenu, openRecordInWorkspace])

  const handleOpenRecordInDetachedWindow = useCallback(() => {
    if (!contextMenu) return
    openRecordInWorkspace(contextMenu.record, { detach: true })
    setContextMenu(null)
  }, [contextMenu, openRecordInWorkspace])

  const handleSelectWork = ({ workId, workArk }: { workId: string; workArk?: string | null }) => {
    const cluster = workspace.clusters.find(entry => entry.anchorId === workId) ?? null
    onStateChange(prev => ({
      ...prev,
      activeWorkAnchorId: cluster?.anchorId ?? null,
      highlightedWorkArk: workArk ?? null,
      viewMode: 'works',
      listScope: 'clusters',
      inventoryFocusWorkId: cluster ? null : workId,
      inventoryFocusExpressionId: null,
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
        inventoryFocusWorkId: null,
        inventoryFocusExpressionId: null,
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
      inventoryFocusWorkId: workId,
      inventoryFocusExpressionId: null,
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
                inventoryFocusExpressionId: null,
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
                inventoryFocusExpressionId: null,
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

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${backlinksExpanded && record ? ' has-backlinks-expanded' : ''
    }${listCollapsed ? ' is-list-collapsed' : ''}`
  const detachLabelFull = t('workspace.openInWindow', { defaultValue: 'Open Intermarc in new window' })
  const dockLabelFull = t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })
  const toggleFullLabelFull = intermarcFullView
    ? t('workspace.collapseIntermarc', { defaultValue: 'Exit full Intermarc view' })
    : t('workspace.expandIntermarc', { defaultValue: 'Expand Intermarc view' })

  return (
    <>
      <div className={workspaceClassName}>
        <header className="workspace-view__header">
          <WorkspaceBreadcrumbs items={breadcrumbs} ariaLabel={t('breadcrumbs.ariaLabel')} />
        </header>
        <div className="workspace-view__body">
          {!listCollapsed ? (
            <aside
              className="workspace-panel workspace-panel--list"
              ref={listPanelRef}
              onScroll={handleListScroll}
            >
              {renderListPanel(state.viewMode)}
            </aside>
          ) : null}
          <section
            className="workspace-panel workspace-panel--details"
            ref={detailsPanelRef}
            onScroll={handleDetailsScroll}
          >
            {record ? (
              <>
                <div className="record-details" onContextMenu={handleRecordContextMenu}>
                  <header className="record-details__header">
                    <h3>{record.id}</h3>
                    <span>{record.type}</span>
                  </header>
                  {editingRecord && canEditRecord ? (
                    <IntermarcEditor
                      record={record}
                      baselineRecord={getCuratedBaselineRecord(record.id) ?? undefined}
                      onSave={next => handleIntermarcSave(record, next)}
                      onCancel={() => setEditingRecord(false)}
                    />
                  ) : (
                    <>
                      <IntermarcView record={record} onArkClick={handleArkClick} />
                      {readOnlyReason ? <p className="record-editor__note">{readOnlyReason}</p> : null}
                      {canEditRecord ? (
                        <div className="editor-actions">
                          <button type="button" onClick={() => setEditingRecord(true)}>
                            {t('buttons.modifyRecord')}
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {!backlinksExpanded ? (
                  <BacklinksPanel backlinks={backlinks} onOpenArk={openRecordForArk} lookupWorkByArk={getByArk} />
                ) : null}
              </>
            ) : (
              <p>{t('layout.selectPrompt')}</p>
            )}
          </section>
          {record && backlinksExpanded ? (
            <section
              className="workspace-panel workspace-panel--backlinks"
              aria-label={t('backlinks.title', { defaultValue: 'Backlinks' })}
            >
              <BacklinksPanel backlinks={backlinks} onOpenArk={openRecordForArk} lookupWorkByArk={getByArk} />
            </section>
          ) : null}
        </div>
        {record ? (
          <div
            className="workspace-side-toolbar"
            aria-label={t('workspace.sidebarActions', { defaultValue: 'Workspace actions' })}
          >
            {mode === 'inline' && onRequestDetach ? (
              <button
                type="button"
                className="workspace-side-toolbar__button"
                onClick={onRequestDetach}
                aria-label={detachLabelFull}
              >
                <span aria-hidden="true" className="workspace-side-toolbar__icon">
                  🪟
                </span>
                <span className="workspace-side-toolbar__label">Pop</span>
              </button>
            ) : null}
            {mode === 'detached' && onRequestDock ? (
              <button
                type="button"
                className="workspace-side-toolbar__button"
                onClick={onRequestDock}
                aria-label={dockLabelFull}
              >
                <span aria-hidden="true" className="workspace-side-toolbar__icon">
                  ↩️
                </span>
                <span className="workspace-side-toolbar__label">Dock</span>
              </button>
            ) : null}
            <button
              type="button"
              className="workspace-side-toolbar__button"
              onClick={() => {
                setIntermarcFullView(prev => {
                  const next = !prev
                  if (next) setBacklinksExpanded(false)
                  return next
                })
              }}
              aria-label={toggleFullLabelFull}
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">
                🖥️
              </span>
              <span className="workspace-side-toolbar__label">{intermarcFullView ? 'Split' : 'Full'}</span>
            </button>
            <button
              type="button"
              className="workspace-side-toolbar__button"
              onClick={() => {
                if (intermarcFullView) setIntermarcFullView(false)
                setListCollapsed(prev => !prev)
              }}
              aria-pressed={listCollapsed}
              aria-label={
                listCollapsed
                  ? t('workspace.showList', { defaultValue: 'Show list' })
                  : t('workspace.hideList', { defaultValue: 'Hide list' })
              }
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">
                {listCollapsed ? '📚' : '🗂️'}
              </span>
              <span className="workspace-side-toolbar__label">
                {listCollapsed
                  ? t('workspace.showList', { defaultValue: 'Show list' })
                  : t('workspace.hideList', { defaultValue: 'Hide list' })}
              </span>
            </button>
            <button
              type="button"
              className="workspace-side-toolbar__button workspace-side-toolbar__button--primary"
              onClick={() =>
                setBacklinksExpanded(prev => {
                  const next = !prev
                  if (next && intermarcFullView) setIntermarcFullView(false)
                  return next
                })
              }
              aria-pressed={backlinksExpanded}
              aria-label={
                backlinksExpanded
                  ? t('backlinks.hide', { defaultValue: 'Fold backlinks' })
                  : t('backlinks.show', { defaultValue: 'Expand backlinks' })
              }
            >
              <span aria-hidden="true" className="workspace-side-toolbar__icon">
                {backlinksExpanded ? '⬇️' : '🔗'}
              </span>
              <span className="workspace-side-toolbar__label">
                {backlinksExpanded ? t('backlinks.hide', { defaultValue: 'Fold links' }) : 'Backlinks'}
              </span>
            </button>
          </div>
        ) : null}
      </div>
      {contextMenu ? (
        <WorkspaceContextMenu
          position={contextMenu.position}
          openLabel={t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })}
          openDetachedLabel={t('workspace.openInDetachedWindow', {
            defaultValue: 'Open in detached workspace window',
          })}
          extraActionLabel={
            contextMenu.record.typeNorm === 'oeuvre'
              ? !pendingClusterSourceRecord
                ? t('works.cluster.prepare', { defaultValue: 'Préparer pour clustering' })
                : pendingClusterSourceRecord.id !== contextMenu.record.id &&
                  pendingClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
                  ? t('works.cluster.clusterWith', { defaultValue: 'Clustériser avec la sélection' })
                  : undefined
              : contextMenu.record.typeNorm === 'expression'
                ? !pendingExpressionClusterSourceRecord
                  ? t('expressions.cluster.prepare', { defaultValue: 'Préparer pour clustering' })
                  : pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                    pendingExpressionClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
                    ? t('expressions.cluster.clusterWith', { defaultValue: 'Clustériser avec la sélection' })
                    : undefined
                : undefined
          }
          extraActionDisabled={
            Boolean(
              (pendingClusterSourceRecord &&
                pendingClusterSourceRecord.id !== contextMenu.record.id &&
                pendingClusterSourceRecord.typeNorm !== contextMenu.record.typeNorm) ||
              (pendingExpressionClusterSourceRecord &&
                pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                pendingExpressionClusterSourceRecord.typeNorm !== contextMenu.record.typeNorm),
            )
          }
          onExtraAction={() => {
            if (contextMenu.record.typeNorm === 'oeuvre') {
              if (!pendingClusterSourceRecord) {
                prepareForClustering(contextMenu.record)
              } else if (
                pendingClusterSourceRecord.id !== contextMenu.record.id &&
                pendingClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
              ) {
                requestClusterWith(contextMenu.record)
              }
            } else if (contextMenu.record.typeNorm === 'expression') {
              if (!pendingExpressionClusterSourceRecord) {
                prepareExpressionForClustering(contextMenu.record)
              } else if (
                pendingExpressionClusterSourceRecord.id !== contextMenu.record.id &&
                pendingExpressionClusterSourceRecord.typeNorm === contextMenu.record.typeNorm
              ) {
                requestExpressionClusterWith(contextMenu.record)
              }
            }
          }}
          onOpen={handleOpenRecordInNewTab}
          onOpenDetached={handleOpenRecordInDetachedWindow}
        />
      ) : null}
      {pendingClusterTarget ? (
        <ConfirmWorkClusterModal
          source={getById(pendingClusterTarget.sourceId) ?? null}
          anchor={getById(pendingClusterTarget.anchorId) ?? null}
          onConfirm={confirmPendingCluster}
          onCancel={() => setPendingClusterTarget(null)}
        />
      ) : null}
      {pendingExpressionClusterTarget ? (
        <ConfirmExpressionClusterModal
          source={getById(pendingExpressionClusterTarget.sourceId) ?? null}
          anchor={getById(pendingExpressionClusterTarget.anchorId) ?? null}
          onConfirm={confirmPendingExpressionCluster}
          onCancel={() => setPendingExpressionClusterTarget(null)}
        />
      ) : null}
    </>
  )
}

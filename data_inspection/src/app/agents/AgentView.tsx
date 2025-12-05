import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { AgentTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { EntityBadgeSpec, RecordRow, WorkRecordPayload } from '../types'
import { useTranslation } from '../hooks/useTranslation'
import { useAppData } from '../providers/AppDataContext'
import { useToast } from '../providers/ToastContext'
import { labelFromRecord } from '../lib/intermarc'
import { IntermarcView } from '../components/IntermarcView'
import { IntermarcEditor } from '../components/IntermarcEditor'
import { BacklinksPanel } from '../components/BacklinksPanel'
import { WorkspaceContextMenu, type MenuAction } from '../components/WorkspaceContextMenu'
import { EntityLabel } from '../components/EntityLabel'
import { configureTabStateForRecord } from '../workspace/tabState'
import { useWorkspaceAgents, useWorkspaceRecord } from '../hooks/useWorkspaceQueries'
import { normalizeType } from '../core/records'
import { parseIntermarc } from '../lib/intermarc'
import { useBacklinks } from '../hooks/useBacklinks'
import { ConfirmAgentClusterModal } from '../components/workspace/ClusterModals'
import { useAgentClustering } from './useAgentClustering'
import { fetchWorkspaceRecord } from '../lib/api'

type AgentViewProps = {
  state: AgentTabState
  onStateChange: (updater: (prev: AgentTabState) => AgentTabState) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentTabDetached: (initializer: (base: AgentTabState) => AgentTabState) => void
  mode: 'inline' | 'detached'
  onRequestDetach?: () => void
  onRequestDock?: () => void
}

type AgentContextMenuState = {
  position: { x: number; y: number }
  agentId?: string
  agentArk?: string | null
  targetArk?: string | null
  source: 'row' | 'intermarc-link' | 'backlinks-link'
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

export function AgentView({
  state,
  onStateChange,
  onOpenTab,
  onOpenAgentTab,
  onOpenAgentTabDetached,
  mode,
  onRequestDetach,
  onRequestDock,
}: AgentViewProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { datasetId, updateRecordIntermarc, getCuratedBaselineRecord, applyServerWorkspaceUpdates } = useAppData()
  const { data: agentsDto } = useWorkspaceAgents(datasetId)
  const clustering = useAgentClustering({
    datasetId,
    agentsDto,
    applyServerWorkspaceUpdates,
    showToast,
    t,
    closeContextMenu: () => setContextMenu(null),
  })
  const {
    pendingSourceId,
    pendingTarget,
    prepareForClustering,
    requestClusterWith,
    confirmPendingCluster,
    cancelPendingCluster,
    toggleAgentClusterMembership,
    getEntry,
  } = clustering

  const selectedAgentKey = state.selectedAgentId ?? null
  const { data: selectedPayload } = useWorkspaceRecord(datasetId, selectedAgentKey)
  const selectedRecord = useMemo<RecordRow | null>(
    () => (selectedPayload ? buildRecordRowFromPayload(selectedPayload) : null),
    [selectedPayload],
  )

  const { data: pendingSourcePayload } = useWorkspaceRecord(datasetId, pendingTarget?.sourceId ?? null)
  const { data: pendingAnchorPayload } = useWorkspaceRecord(datasetId, pendingTarget?.anchorId ?? null)

  const pendingSourceRecord = useMemo<RecordRow | null>(
    () => (pendingSourcePayload ? buildRecordRowFromPayload(pendingSourcePayload) : null),
    [pendingSourcePayload],
  )
  const pendingAnchorRecord = useMemo<RecordRow | null>(
    () => (pendingAnchorPayload ? buildRecordRowFromPayload(pendingAnchorPayload) : null),
    [pendingAnchorPayload],
  )

  const backlinksQuery = useBacklinks(datasetId, selectedAgentKey)
  const backlinks = backlinksQuery.backlinks
  const backlinksLoading = backlinksQuery.isFetching || backlinksQuery.isLoading

  const listRef = useRef<HTMLElement | null>(null)
  const detailsRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
  const autoFullRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const backlinksExpanded = state.backlinksExpanded
  const listCollapsed = state.listCollapsed
  const intermarcFullView = state.intermarcFullView
  const [contextMenu, setContextMenu] = useState<AgentContextMenuState | null>(null)

  const entries = useMemo(() => {
    if (!agentsDto)
      return [] as Array<{ kind: 'cluster'; anchorId: string; sortKey: string } | { kind: 'single'; agentId: string; sortKey: string }>
    const list: Array<{ kind: 'cluster'; anchorId: string; sortKey: string } | { kind: 'single'; agentId: string; sortKey: string }> = []
    agentsDto.clusters.forEach(cluster => {
      const sortKey = cluster.sort_key ?? cluster.anchor_label ?? cluster.anchor_id
      list.push({ kind: 'cluster', anchorId: cluster.anchor_id, sortKey })
    })
    agentsDto.unclustered_agents.forEach(agent => {
      const sortKey = agent.sort_key ?? agent.label ?? agent.id
      list.push({ kind: 'single', agentId: agent.id, sortKey })
    })
    return list.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'fr', { sensitivity: 'accent' }))
  }, [agentsDto])

  useEffect(() => {
    setEditing(false)
  }, [state.selectedAgentId, mode])

  useEffect(() => {
    if (backlinksExpanded && intermarcFullView) {
      onStateChange(prev => ({ ...prev, intermarcFullView: false }))
    }
  }, [backlinksExpanded, intermarcFullView, onStateChange])

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

  useLayoutEffect(() => {
    const node = listRef.current
    if (!node) return
    if (Math.abs(node.scrollTop - state.listScrollTop) > 1) node.scrollTop = state.listScrollTop
  }, [state.listScrollTop])

  useLayoutEffect(() => {
    const node = detailsRef.current
    if (!node) return
    if (Math.abs(node.scrollTop - state.detailsScrollTop) > 1) node.scrollTop = state.detailsScrollTop
  }, [state.detailsScrollTop])

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const next = event.currentTarget.scrollTop
      onStateChange(prev => (Math.abs(prev.listScrollTop - next) < 0.5 ? prev : { ...prev, listScrollTop: next }))
    },
    [onStateChange],
  )

  const handleDetailsScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const next = event.currentTarget.scrollTop
      onStateChange(prev => (Math.abs(prev.detailsScrollTop - next) < 0.5 ? prev : { ...prev, detailsScrollTop: next }))
    },
    [onStateChange],
  )

  useEffect(() => {
    const key = `${state.selectedAgentId}`
    if (lastScrollKeyRef.current === key) return
    lastScrollKeyRef.current = key
    if (typeof window === 'undefined') return
    const container = listRef.current
    if (!container) return
    window.requestAnimationFrame(() => {
      const target =
        container.querySelector<HTMLElement>('.entity-row.selected') ||
        container.querySelector<HTMLElement>('.entity-row.highlight')
      if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [state.selectedAgentId])

  const openRecord = useCallback(
    (record: RecordRow, opts?: { detach?: boolean }) => {
      const initializer = (base: WorkspaceTabStateWorkspace) =>
        configureTabStateForRecord(base, record, {
          clusters: [],
          indexes: {
            worksById: new Map(),
            worksByArk: new Map(),
            expressionsById: new Map(),
            expressionsByArk: new Map(),
            expressionsByWorkArk: new Map(),
            manifestationsById: new Map(),
            manifestationsByExpressionArk: new Map(),
          },
          curatedRecords: [record],
        })
      if (opts?.detach) {
        onOpenAgentTabDetached(base => ({ ...base, selectedAgentId: record.id }))
        return
      }
      onOpenAgentTab(base => ({ ...base, selectedAgentId: record.id }))
      onOpenTab(initializer)
    },
    [onOpenAgentTab, onOpenAgentTabDetached, onOpenTab],
  )

  const openArk = useCallback(
    async (ark: string, opts?: { detach?: boolean }) => {
      const trimmed = ark.trim()
      if (!trimmed || !datasetId) return
      if (selectedRecord && (selectedRecord.ark === trimmed || selectedRecord.id === trimmed)) {
        openRecord(selectedRecord, opts)
        return
      }
      try {
        const payload = await fetchWorkspaceRecord(datasetId, trimmed)
        const record = buildRecordRowFromPayload(payload)
        openRecord(record, opts)
      } catch {
        showToast(
          t('workspace.sparqlNoRecordForArk', { defaultValue: 'No record found for this ARK.' }),
          { tone: 'error' },
        )
      }
    },
    [datasetId, openRecord, selectedRecord, showToast, t],
  )

  const handleRowClick = useCallback(
    (agentId: string) => {
      onStateChange(prev => ({ ...prev, selectedAgentId: agentId }))
    },
    [onStateChange],
  )

  const openContextMenuForAgent = useCallback(
    (event: React.MouseEvent<HTMLElement>, agentId: string, agentArk?: string | null) => {
      event.preventDefault()
      handleRowClick(agentId)
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        agentId,
        agentArk,
        targetArk: agentArk ?? null,
        source: 'row',
      })
    },
    [handleRowClick],
  )

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

  const buildContextMenuActions = useCallback(
    (agentId: string): MenuAction[] => {
      const entry = getEntry(agentId)
      if (!entry) return []
      if (!pendingSourceId) {
        return [
          {
            label: t('agents.cluster.prepare', { defaultValue: 'Prepare for clustering' }),
            onSelect: () => prepareForClustering(entry),
          },
        ]
      }
      if (pendingSourceId !== agentId) {
        return [
          {
            label: t('agents.cluster.clusterWith', { defaultValue: 'Cluster selected agent here' }),
            onSelect: () => requestClusterWith(entry),
          },
        ]
      }
      return []
    },
    [getEntry, pendingSourceId, prepareForClustering, requestClusterWith, t],
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

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const raw = arkLink.getAttribute('data-ark')
      if (!raw || !selectedRecord) return
      event.preventDefault()
      const source: AgentContextMenuState['source'] = target?.closest('.backlinks-panel')
        ? 'backlinks-link'
        : 'intermarc-link'
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        agentId: selectedRecord.id,
        agentArk: selectedRecord.ark,
        targetArk: raw,
        source,
      })
    },
    [selectedRecord],
  )

  const renderCluster = useCallback(
    (anchorId: string) => {
      console.log('renderCluster', anchorId)
      if (!agentsDto) return null
      const cluster = agentsDto.clusters.find(c => c.anchor_id === anchorId)
      if (!cluster) return null
      const anchorSelected = state.selectedAgentId === anchorId
      const anchorLabel = cluster.anchor_label || cluster.anchor_id
      const anchorSegments = cluster.anchor_title_segments || []
      const anchorArk = cluster.anchor_ark ?? undefined
      const rowClasses = ['entity-row', 'entity-row--person']
      if (anchorSelected) rowClasses.push('selected')
      if (pendingSourceId && pendingSourceId === cluster.anchor_id) rowClasses.push('pending-cluster-source')
      const badges: EntityBadgeSpec[] = [
        { type: 'person', text: cluster.anchor_id, tooltip: anchorArk ?? cluster.anchor_id },
      ]
      return (
        <div key={`cluster-${cluster.anchor_id}`} className="cluster">
          <div
            className={rowClasses.join(' ')}
            data-agent-id={cluster.anchor_id}
            data-agent-ark={anchorArk}
            onClick={() => handleRowClick(cluster.anchor_id)}
            onContextMenu={event => openContextMenuForAgent(event, cluster.anchor_id, anchorArk)}
          >
            <span className="cluster-anchor-marker">⚓︎</span>
            <EntityLabel title={anchorLabel} badges={badges} titleSegments={anchorSegments} />
          </div>
          <div className="cluster-items">
            {cluster.items.map(item => {
              const itemKey = item.id ?? item.ark
              const itemSelected = state.selectedAgentId === itemKey
              const itemClasses = ['cluster-item', 'entity-row', 'entity-row--person']
              if (itemSelected) itemClasses.push('selected')
              if (pendingSourceId && pendingSourceId === itemKey) itemClasses.push('pending-cluster-source')
              const itemSegments = item.title_segments ?? []
              return (
                <div
                  key={`${cluster.anchor_id}-${item.ark}`}
                  className={itemClasses.join(' ')}
                  data-agent-id={itemKey ?? ''}
                  data-agent-ark={item.ark}
                  onClick={() => itemKey && handleRowClick(itemKey)}
                  onContextMenu={event => itemKey && openContextMenuForAgent(event, itemKey, item.ark)}
                  >
                    <input
                      type="checkbox"
                      checked={item.accepted !== false}
                      onChange={event =>
                      toggleAgentClusterMembership({
                        anchorId: cluster.anchor_id,
                        targetArk: item.ark,
                        targetId: item.id ?? undefined,
                        accepted: event.currentTarget.checked,
                      })
                    }
                  />
                    <EntityLabel
                      title={item.label || item.ark}
                      titleSegments={itemSegments}
                      badges={[{ type: 'person', text: item.id ?? item.ark, tooltip: item.ark }]}
                    />
                </div>
              )
            })}
          </div>
        </div>
      )
    },
    [agentsDto, handleRowClick, openContextMenuForAgent, pendingSourceId, state.selectedAgentId, toggleAgentClusterMembership],
  )

  const renderUnclustered = useCallback(
    (agentId: string) => {
      if (!agentsDto) return null
      const agent = agentsDto.unclustered_agents.find(a => a.id === agentId)
      if (!agent) return null
      const isSelected = state.selectedAgentId === agent.id
      const rowClasses = ['entity-row', 'entity-row--person']
      if (isSelected) rowClasses.push('selected')
      if (pendingSourceId && pendingSourceId === agent.id) rowClasses.push('pending-cluster-source')
      const segments = agent.title_segments ?? []
      return (
        <div
          key={`agent-${agent.id}`}
          className={rowClasses.join(' ')}
          data-agent-id={agent.id}
          onClick={() => handleRowClick(agent.id)}
          onContextMenu={event => openContextMenuForAgent(event, agent.id, agent.ark)}
        >
          <EntityLabel
            title={agent.label || agent.id}
            titleSegments={segments}
            badges={[{ type: 'person', text: agent.id, tooltip: agent.ark ?? agent.id }]}
          />
        </div>
      )
    },
    [agentsDto, handleRowClick, openContextMenuForAgent, pendingSourceId, state.selectedAgentId],
  )

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${backlinksExpanded && selectedRecord ? ' has-backlinks-expanded' : ''
    }${listCollapsed ? ' is-list-collapsed' : ''}`
  const detachLabelFull = t('workspace.openInWindow', { defaultValue: 'Open Intermarc in new window' })
  const dockLabelFull =
    mode === 'detached'
      ? t('workspace.redockTabMainApp', { defaultValue: "Ramener l'onglet dans l'application centrale" })
      : t('workspace.redockTab', { defaultValue: 'Ramener l’onglet ici' })
  const toggleFullLabelFull = intermarcFullView
    ? t('workspace.collapseIntermarc', { defaultValue: 'Exit full Intermarc view' })
    : t('workspace.expandIntermarc', { defaultValue: 'Expand Intermarc view' })

  return (
    <>
      <div className={workspaceClassName}>
        <header className="workspace-view__header">
          <h3>{t('workspace.agentsTitle', { defaultValue: 'Agents' })}</h3>
        </header>
        <div className="workspace-view__body">
          {!listCollapsed ? (
            <aside
              className="workspace-panel workspace-panel--list"
              style={{ height: 'calc(100vh - var(--app-sticky-offset, 0px) - 1.5rem)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {entries.length ? (
                <Virtuoso
                  style={{ height: '100%', width: '100%' }}
                  className="work-list-panel"
                  data={entries}
                  scrollerRef={(node) => {
                    listRef.current = node as HTMLElement | null
                  }}
                  onScroll={(event) => handleListScroll(event as unknown as UIEvent<HTMLElement>)}
                  computeItemKey={(_, item) =>
                    item.kind === 'cluster' ? `cluster-${item.anchorId}` : `agent-${item.agentId}`
                  }
                  itemContent={(_, entry) => (entry.kind === 'cluster' ? renderCluster(entry.anchorId) : renderUnclustered(entry.agentId))}
                />
              ) : (
                <div className="work-list-panel">
                  <em>{t('messages.noAgents', { defaultValue: 'No agents found.' })}</em>
                </div>
              )}
            </aside>
          ) : null}
          <section
            className="workspace-panel workspace-panel--details"
            ref={detailsRef}
            onScroll={handleDetailsScroll}
          >
            {selectedRecord ? (
              <div className="record-details" onContextMenu={handleContextMenu}>
                <header className="record-details__header">
                  <h3>{labelFromRecord(selectedRecord) || selectedRecord.id}</h3>
                  <span>{selectedRecord.type}</span>
                </header>
                {editing ? (
                  <IntermarcEditor
                    record={selectedRecord}
                    baselineRecord={getCuratedBaselineRecord(selectedRecord.id) ?? undefined}
                    onSave={next => updateRecordIntermarc(selectedRecord.id, next)}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <>
                    <IntermarcView record={selectedRecord} onArkClick={ark => openArk(ark)} />
                    <div className="editor-actions">
                      <button type="button" onClick={() => setEditing(true)}>
                        {t('buttons.modifyRecord')}
                      </button>
                    </div>
                  </>
                )}
                {!backlinksExpanded ? (
                  <BacklinksPanel
                    backlinks={backlinks}
                    loading={backlinksLoading}
                    onOpenArk={ark => openArk(ark)}
                    onArkContextMenu={handleContextMenu}
                  />
                ) : null}
              </div>
            ) : (
              <p>{t('layout.selectPrompt')}</p>
            )}
          </section>
          {selectedRecord && backlinksExpanded ? (
            <section
              className="workspace-panel workspace-panel--backlinks"
              aria-label={t('backlinks.title', { defaultValue: 'Backlinks' })}
            >
              <BacklinksPanel
                backlinks={backlinks}
                loading={backlinksLoading}
                onOpenArk={ark => openArk(ark)}
                onArkContextMenu={handleContextMenu}
              />
            </section>
          ) : null}
        </div>
        {selectedRecord ? (
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
              onClick={() =>
                setIntermarcFullView(prev => {
                  const next = !prev
                  if (next) setBacklinksExpanded(false)
                  return next
                })
              }
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
          openLabel={
            contextMenu.source === 'backlinks-link'
              ? t('workspace.openInDetachedWindow', { defaultValue: 'Open in detached workspace window' })
              : t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })
          }
          openDetachedLabel={
            contextMenu.source === 'backlinks-link'
              ? t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })
              : t('workspace.openInDetachedWindow', { defaultValue: 'Open in detached workspace window' })
          }
          extraActions={contextMenu.source === 'row' ? buildContextMenuActions(contextMenu.agentId) : undefined}
          onOpen={() => {
            const detach = contextMenu.source === 'backlinks-link'
            const target = contextMenu.targetArk ?? contextMenu.agentArk ?? contextMenu.agentId ?? null
            if (target) openArk(target, detach ? { detach: true } : undefined)
            setContextMenu(null)
          }}
          onOpenDetached={() => {
            const detach = contextMenu.source !== 'backlinks-link'
            const target = contextMenu.targetArk ?? contextMenu.agentArk ?? contextMenu.agentId ?? null
            if (target) openArk(target, detach ? { detach: true } : undefined)
            setContextMenu(null)
          }}
        />
      ) : null}

      {pendingTarget ? (
        <ConfirmAgentClusterModal
          source={pendingSourceRecord}
          anchor={pendingAnchorRecord}
          onConfirm={confirmPendingCluster}
          onCancel={cancelPendingCluster}
        />
      ) : null}
    </>
  )
}

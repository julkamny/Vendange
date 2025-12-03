import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { AgentTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { EntityBadgeSpec, RecordRow, WorkRecordPayload } from '../types'
import { useTranslation } from '../hooks/useTranslation'
import { useAppData } from '../providers/AppDataContext'
import { labelFromRecord } from '../lib/intermarc'
import { IntermarcView } from '../components/IntermarcView'
import { IntermarcEditor } from '../components/IntermarcEditor'
import { BacklinksPanel } from '../components/BacklinksPanel'
import { WorkspaceContextMenu } from '../components/WorkspaceContextMenu'
import { EntityLabel } from '../components/EntityLabel'
import { configureTabStateForRecord } from '../workspace/tabState'
import { useWorkspaceAgents, useWorkspaceRecord } from '../hooks/useWorkspaceQueries'
import { normalizeType } from '../core/records'
import { parseIntermarc } from '../lib/intermarc'
import { useBacklinks } from '../hooks/useBacklinks'

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
  record: RecordRow
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
  const { datasetId, updateRecordIntermarc, getCuratedBaselineRecord } = useAppData()
  const { data: agentsDto } = useWorkspaceAgents(datasetId)

  const selectedAgentKey = state.selectedAgentId ?? null
  const { data: selectedPayload } = useWorkspaceRecord(datasetId, selectedAgentKey)
  const selectedRecord = useMemo<RecordRow | null>(
    () => (selectedPayload ? buildRecordRowFromPayload(selectedPayload) : null),
    [selectedPayload],
  )

  const backlinksQuery = useBacklinks(datasetId, selectedAgentKey)
  const backlinks = backlinksQuery.backlinks
  const backlinksLoading = backlinksQuery.isFetching || backlinksQuery.isLoading

  const listRef = useRef<HTMLElement | null>(null)
  const detailsRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
  const [editing, setEditing] = useState(false)
  const backlinksExpanded = state.backlinksExpanded
  const listCollapsed = state.listCollapsed
  const intermarcFullView = state.intermarcFullView
  const [contextMenu, setContextMenu] = useState<AgentContextMenuState | null>(null)

  const entries = useMemo(() => {
    if (!agentsDto) return [] as Array<{ kind: 'cluster'; anchorId: string } | { kind: 'single'; agentId: string }>
    const clusterEntries = agentsDto.clusters.map(cluster => ({ kind: 'cluster' as const, anchorId: cluster.anchor_id }))
    const singleEntries = agentsDto.unclustered_agents.map(agent => ({ kind: 'single' as const, agentId: agent.id }))
    return [...clusterEntries, ...singleEntries]
  }, [agentsDto])

  useEffect(() => {
    setEditing(false)
  }, [state.selectedAgentId, mode])

  useEffect(() => {
    if (backlinksExpanded && intermarcFullView) {
      onStateChange(prev => ({ ...prev, intermarcFullView: false }))
    }
  }, [backlinksExpanded, intermarcFullView, onStateChange])

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
      if (opts?.detach) onOpenAgentTabDetached(base => ({ ...base, selectedAgentId: record.id }))
      else onOpenAgentTab(base => ({ ...base, selectedAgentId: record.id }))
      // also open workspace tab for cross-navigation
      onOpenTab(initializer)
    },
    [onOpenAgentTab, onOpenAgentTabDetached, onOpenTab],
  )

  const openArk = useCallback(
    (ark: string, opts?: { detach?: boolean }) => {
      const trimmed = ark.trim()
      if (!trimmed) return
      if (selectedRecord && selectedRecord.ark === trimmed) {
        openRecord(selectedRecord, opts)
      }
    },
    [openRecord, selectedRecord],
  )

  const handleRowClick = useCallback(
    (agentId: string) => {
      onStateChange(prev => ({ ...prev, selectedAgentId: agentId }))
    },
    [onStateChange],
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
      if (!raw || !selectedRecord || selectedRecord.ark !== raw) return
      event.preventDefault()
      setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: selectedRecord })
    },
    [selectedRecord],
  )

  const renderCluster = useCallback(
    (anchorId: string) => {
      if (!agentsDto) return null
      const cluster = agentsDto.clusters.find(c => c.anchor_id === anchorId)
      if (!cluster) return null
      const anchorSelected = state.selectedAgentId === anchorId
      const anchorLabel = cluster.anchor_label || cluster.anchor_id
      const anchorArk = cluster.anchor_ark ?? undefined
      const rowClasses = ['entity-row', 'entity-row--person']
      if (anchorSelected) rowClasses.push('selected')
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
          >
            <span className="cluster-anchor-marker">⚓︎</span>
            <EntityLabel title={anchorLabel} badges={badges} />
          </div>
          <div className="cluster-items">
            {cluster.items.map(item => {
              const itemSelected = state.selectedAgentId === item.id
              const itemClasses = ['cluster-item', 'entity-row', 'entity-row--person']
              if (itemSelected) itemClasses.push('selected')
              return (
                <div
                  key={`${cluster.anchor_id}-${item.ark}`}
                  className={itemClasses.join(' ')}
                  data-agent-id={item.id ?? item.ark}
                  data-agent-ark={item.ark}
                  onClick={() => handleRowClick(item.id ?? item.ark)}
                >
                  <input type="checkbox" checked readOnly />
                  <EntityLabel
                    title={item.label || item.ark}
                    badges={[{ type: 'person', text: item.id ?? item.ark, tooltip: item.ark }]}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )
    },
    [agentsDto, handleRowClick, state.selectedAgentId],
  )

  const renderUnclustered = useCallback(
    (agentId: string) => {
      if (!agentsDto) return null
      const agent = agentsDto.unclustered_agents.find(a => a.id === agentId)
      if (!agent) return null
      const isSelected = state.selectedAgentId === agent.id
      const rowClasses = ['entity-row', 'entity-row--person']
      if (isSelected) rowClasses.push('selected')
      return (
        <div
          key={`agent-${agent.id}`}
          className={rowClasses.join(' ')}
          data-agent-id={agent.id}
          onClick={() => handleRowClick(agent.id)}
        >
          <EntityLabel
            title={agent.label || agent.id}
            badges={[{ type: 'person', text: agent.id, tooltip: agent.ark ?? agent.id }]}
          />
        </div>
      )
    },
    [agentsDto, handleRowClick, state.selectedAgentId],
  )

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${backlinksExpanded && selectedRecord ? ' has-backlinks-expanded' : ''
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
          <h3>{t('workspace.agentsTitle', { defaultValue: 'Agents' })}</h3>
        </header>
        <div className="workspace-view__body">
          {!listCollapsed ? (
            <aside
              className="workspace-panel workspace-panel--list"
              style={{ height: 'calc(100vh - var(--app-sticky-offset) - 1.5rem)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
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
                  <BacklinksPanel backlinks={backlinks} loading={backlinksLoading} onOpenArk={ark => openArk(ark)} />
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
              <BacklinksPanel backlinks={backlinks} loading={backlinksLoading} onOpenArk={ark => openArk(ark)} />
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
          openLabel={t('workspace.openInNewTab', { defaultValue: 'Open in new workspace tab' })}
          openDetachedLabel={t('workspace.openInDetachedWindow', {
            defaultValue: 'Open in detached workspace window',
          })}
          extraActions={[]}
          onOpen={() => {
            if (contextMenu.record) openRecord(contextMenu.record)
            setContextMenu(null)
          }}
          onOpenDetached={() => {
            if (contextMenu.record) openRecord(contextMenu.record, { detach: true })
            setContextMenu(null)
          }}
        />
      ) : null}
    </>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { AgentTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { RecordRow } from '../types'
import { useAgentData, isAgentRecord } from './useAgentData'
import { useTranslation } from '../hooks/useTranslation'
import { useAppData } from '../providers/AppDataContext'
import { buildLabelFromIntermarc } from '../lib/intermarc'
import { IntermarcView } from '../components/IntermarcView'
import { IntermarcEditor } from '../components/IntermarcEditor'
import { BacklinksPanel } from '../components/BacklinksPanel'
import { useBacklinks } from '../hooks/useBacklinks'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { WorkspaceContextMenu } from '../components/WorkspaceContextMenu'
import { configureTabStateForRecord } from '../workspace/tabState'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'

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
  const { agents } = useAgentData()
  const { updateRecordIntermarc, getCuratedBaselineRecord, clusters, curated } = useAppData()
  const { getByArk, getById } = useRecordLookup()
  const { getBacklinksForRecord } = useBacklinks()
  const stubWorkspaceState = useMemo<WorkspaceTabStateWorkspace>(
    () => ({ ...DEFAULT_WORKSPACE_STATE, id: '__agent_ctx__', title: 'Workspace' }),
    [],
  )
  const workspaceData = useWorkspaceData(stubWorkspaceState)

  const listRef = useRef<HTMLElement | null>(null)
  const detailsRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
  const [editing, setEditing] = useState(false)
  const [backlinksExpanded, setBacklinksExpanded] = useState(false)
  const intermarcFullView = state.intermarcFullView
  const [contextMenu, setContextMenu] = useState<AgentContextMenuState | null>(null)
  const tabContext = useMemo(
    () => ({
      clusters,
      indexes: workspaceData.indexes,
      curatedRecords: curated?.records ?? [],
    }),
    [clusters, curated?.records, workspaceData.indexes],
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

  const selectedRecord = useMemo<RecordRow | null>(() => {
    const targetId = state.selectedAgentId
    if (!targetId) return null
    const rec = getById(targetId)
    return isAgentRecord(rec) ? rec : null
  }, [getById, state.selectedAgentId])

  const backlinks = useMemo(
    () => (selectedRecord ? getBacklinksForRecord(selectedRecord) : []),
    [getBacklinksForRecord, selectedRecord],
  )

  useEffect(() => {
    setEditing(false)
    setBacklinksExpanded(false)
  }, [state.selectedAgentId, mode])

  useEffect(() => {
    if (backlinksExpanded && intermarcFullView) {
      setIntermarcFullView(false)
    }
  }, [backlinksExpanded, intermarcFullView, setIntermarcFullView])

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
      if (isAgentRecord(record)) {
        const initializer = (base: AgentTabState) => ({ ...base, selectedAgentId: record.id })
        if (opts?.detach) onOpenAgentTabDetached(initializer)
        else onOpenAgentTab(initializer)
      } else {
        const initializer = (base: WorkspaceTabStateWorkspace) => configureTabStateForRecord(base, record, tabContext)
        onOpenTab(initializer)
      }
    },
    [onOpenAgentTab, onOpenAgentTabDetached, onOpenTab, tabContext],
  )

  const openArk = useCallback(
    (ark: string, opts?: { detach?: boolean }) => {
      const trimmed = ark.trim()
      if (!trimmed) return
      let target = getByArk(trimmed)
      if (!target) {
        const id = trimmed.replace(/^ark:\//, '')
        target = getById(id)
      }
      if (!target) return
      openRecord(target, opts)
    },
    [getByArk, getById, openRecord],
  )

  const handleRowClick = useCallback(
    (record: RecordRow) => {
      onStateChange(prev => ({
        ...prev,
        selectedAgentId: record.id,
      }))
    },
    [onStateChange],
  )

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const raw = arkLink.getAttribute('data-ark')
      if (!raw) return
      const record = getByArk(raw) || getById(raw.replace(/^ark:\//, ''))
      if (!isAgentRecord(record)) return
      event.preventDefault()
      setContextMenu({ position: { x: event.clientX, y: event.clientY }, record })
    },
    [getByArk, getById],
  )

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClose = (event: MouseEvent | KeyboardEvent) => {
      const target = (event as MouseEvent).target as HTMLElement | null
      if (target?.closest('.workspace-context-menu')) return
      if ((event as KeyboardEvent).key === 'Escape') setContextMenu(null)
      if (event.type === 'click') setContextMenu(null)
    }
    window.addEventListener('click', handleClose)
    window.addEventListener('keydown', handleClose)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('keydown', handleClose)
    }
  }, [contextMenu])

  const renderRow = (record: RecordRow) => {
    const classes = ['entity-row', 'entity-row--person']
    if (record.typeNorm === 'collectivite') classes.push('entity-row--collective')
    if (record.typeNorm === 'famille') classes.push('entity-row--person')
    if (state.selectedAgentId === record.id) classes.push('selected')
    const label = buildLabelFromIntermarc(record.intermarc, record.type) || record.id
    const clusterZones = (record.intermarc as any)?.['90F'] as any[] | undefined
    const clustered = Array.isArray(clusterZones)
      ? clusterZones.some(zone => zone?.subfields?.some((s: any) => s.code === 'q' && s.value === 'Clusterisation script'))
      : false
    return (
      <div
        key={record.id}
        className={classes.join(' ')}
        data-agent-id={record.id}
        onClick={() => handleRowClick(record)}
        onContextMenu={e => {
          e.preventDefault()
          setContextMenu({ position: { x: e.clientX, y: e.clientY }, record })
        }}
      >
        <span className="entity-title">{label}</span>
        {record.ark ? <span className="entity-id">{record.ark}</span> : null}
        {clustered ? <span className="entity-cluster-flag">🍇</span> : null}
      </div>
    )
  }

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${
    backlinksExpanded && selectedRecord ? ' has-backlinks-expanded' : ''
  }`
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
          <aside className="workspace-panel workspace-panel--list" ref={listRef} onScroll={handleListScroll}>
            <div className="work-list-panel">
              {agents.map(renderRow)}
              {!agents.length ? <em>{t('messages.noAgents', { defaultValue: 'No agents found.' })}</em> : null}
            </div>
          </aside>
          <section
            className="workspace-panel workspace-panel--details"
            ref={detailsRef}
            onScroll={handleDetailsScroll}
          >
            {selectedRecord ? (
              <div className="record-details" onContextMenu={handleContextMenu}>
                <header className="record-details__header">
                  <h3>{buildLabelFromIntermarc(selectedRecord.intermarc, selectedRecord.type) || selectedRecord.id}</h3>
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
                  <BacklinksPanel backlinks={backlinks} onOpenArk={ark => openArk(ark)} lookupWorkByArk={getByArk} />
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
              <BacklinksPanel backlinks={backlinks} onOpenArk={ark => openArk(ark)} lookupWorkByArk={getByArk} />
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
          onOpen={() => {
            openRecord(contextMenu.record)
            setContextMenu(null)
          }}
          onOpenDetached={() => {
            openRecord(contextMenu.record, { detach: true })
            setContextMenu(null)
          }}
        />
      ) : null}
    </>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { AgentTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { RecordRow } from '../types'
import { useAgentData, isAgentRecord } from './useAgentData'
import { useTranslation } from '../hooks/useTranslation'
import { useAppData } from '../providers/AppDataContext'
import { buildLabelFromIntermarc, findZones, addManualAgent90FEntries } from '../lib/intermarc'
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

type AgentClusterItem = {
  ark: string
  id?: string
  label: string
  status: 'accepted' | 'rejected'
}

type AgentCluster = {
  anchorId: string
  anchorArk?: string
  anchorLabel: string
  items: AgentClusterItem[]
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

  const buildAgentLabel = useCallback(
    (record: RecordRow | null | undefined) =>
      record ? buildLabelFromIntermarc(record.intermarc, record.type) || record.id : '',
    [],
  )

  const baseAgentClusters = useMemo(
    () => buildAgentClusters(agents, buildAgentLabel),
    [agents, buildAgentLabel],
  )

  const [agentClusters, setAgentClusters] = useState<AgentCluster[]>(baseAgentClusters)

  useEffect(() => {
    setAgentClusters(prev => mergeAgentClusters(baseAgentClusters, prev))
  }, [baseAgentClusters])

  const persistManualAgentCluster = useCallback(
    (anchorId: string, items: AgentClusterItem[]) => {
      const anchorRecord = getById(anchorId)
      if (!anchorRecord) return
      const accepted = items.filter(item => item.status === 'accepted').map(item => ({ ark: item.ark }))
      const nextIntermarc = addManualAgent90FEntries(anchorRecord.intermarc, accepted)
      updateRecordIntermarc(anchorRecord.id, nextIntermarc)
    },
    [getById, updateRecordIntermarc],
  )

  const setClusterItemStatus = useCallback(
    (anchorId: string, targetArk: string, status: AgentClusterItem['status']) => {
      let nextItems: AgentClusterItem[] | null = null
      setAgentClusters(prev => {
        let updated = false
        const next = prev
          .map(cluster => {
            if (cluster.anchorId !== anchorId) return cluster
            updated = true
            const items = cluster.items.map(item =>
              item.ark === targetArk ? { ...item, status } : item,
            )
            nextItems = items
            return { ...cluster, items }
          })
          .filter(cluster => cluster.items.length > 0)

        if (!updated) return prev
        return next
      })
      if (nextItems) {
        persistManualAgentCluster(anchorId, nextItems)
      }
    },
    [persistManualAgentCluster],
  )

  const removeClusterItem = useCallback(
    (anchorId: string, targetArk: string) => {
      let nextItems: AgentClusterItem[] | null = null
      setAgentClusters(prev => {
        let updated = false
        const next = prev
          .map(cluster => {
            if (cluster.anchorId !== anchorId) return cluster
            updated = true
            const items = cluster.items.filter(item => item.ark !== targetArk)
            nextItems = items
            return { ...cluster, items }
          })
          .filter(cluster => cluster.items.length > 0)

        if (!updated) return prev
        return next
      })
      if (nextItems !== null) {
        persistManualAgentCluster(anchorId, nextItems)
      }
    },
    [persistManualAgentCluster],
  )

  const listRef = useRef<HTMLElement | null>(null)
  const detailsRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
  const [editing, setEditing] = useState(false)
  const backlinksExpanded = state.backlinksExpanded
  const listCollapsed = state.listCollapsed
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

    type SubField = { code?: string; value?: string }
    type Zone = { subfields?: SubField[] }
    const raw90F = (record.intermarc as Record<string, unknown>)?.['90F'] ?? null
    const clusterZones: Zone[] = Array.isArray(raw90F) ? raw90F.filter((z): z is Zone => typeof z === 'object' && !!z) : []
    const clustered = clusterZones.some(zone =>
      Array.isArray(zone.subfields) &&
      zone.subfields.some(sf => sf?.code === 'q' && (sf?.value === 'Clusterisation script' || sf?.value === 'Clusterisation manuelle')),
    )
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

  const collator = useMemo(() => new Intl.Collator('fr', { sensitivity: 'accent' }), [])

  const clusteredAgentIds = useMemo(() => {
    const ids = new Set<string>()
    agentClusters.forEach(cluster => {
      ids.add(cluster.anchorId)
      cluster.items.forEach(item => {
        if (item.id) ids.add(item.id)
      })
    })
    return ids
  }, [agentClusters])

  const sortedEntries = useMemo(() => {
    type Entry = { kind: 'cluster'; cluster: AgentCluster; title: string } | { kind: 'single'; agent: RecordRow; title: string }
    const clusterEntries: Entry[] = agentClusters.map(cluster => ({
      kind: 'cluster',
      cluster,
      title: cluster.anchorLabel || cluster.anchorId,
    }))

    const unclusteredEntries: Entry[] = agents
      .filter(agent => !clusteredAgentIds.has(agent.id))
      .map(agent => ({ kind: 'single', agent, title: buildAgentLabel(agent) || agent.id }))

    return [...clusterEntries, ...unclusteredEntries].sort((a, b) => collator.compare(a.title, b.title))
  }, [agentClusters, agents, buildAgentLabel, collator, clusteredAgentIds])

  const workspaceClassName = `workspace-view${intermarcFullView ? ' is-intermarc-full' : ''}${
    backlinksExpanded && selectedRecord ? ' has-backlinks-expanded' : ''
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
            <aside className="workspace-panel workspace-panel--list" ref={listRef} onScroll={handleListScroll}>
              <div className="work-list-panel">
                {sortedEntries.map(entry => {
                  if (entry.kind === 'single') {
                    return renderRow(entry.agent)
                  }

                  const { cluster } = entry
                  const anchorRecord = getById(cluster.anchorId)
                  const clusterClasses = ['cluster']
                  const anchorClasses = ['cluster-header-row', 'entity-row', 'entity-row--person']
                  if (state.selectedAgentId === cluster.anchorId) anchorClasses.push('selected')

                  return (
                    <div key={`cluster-${cluster.anchorId}`} className={clusterClasses.join(' ')} data-cluster-anchor-id={cluster.anchorId}>
                      <div
                        className={anchorClasses.join(' ')}
                        data-agent-id={cluster.anchorId}
                        data-agent-ark={cluster.anchorArk}
                        onClick={() => {
                          if (anchorRecord) handleRowClick(anchorRecord)
                        }}
                        onContextMenu={event => {
                          if (!anchorRecord) return
                          event.preventDefault()
                          setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: anchorRecord })
                        }}
                      >
                        <div className="cluster-header">
                          <span className="cluster-anchor-marker">⚓︎</span>
                          <span className="entity-title">{cluster.anchorLabel || cluster.anchorId}</span>
                          {cluster.anchorArk ? <span className="entity-id">{cluster.anchorArk}</span> : null}
                        </div>
                      </div>
                      <div className="cluster-items">
                        {cluster.items.map(item => {
                          const itemRecord = item.id ? getById(item.id) : null
                          const rowClasses = ['cluster-item', 'entity-row', 'entity-row--person']
                          if (item.status === 'rejected') rowClasses.push('unchecked')
                          if (itemRecord && state.selectedAgentId === itemRecord.id) rowClasses.push('selected')

                          return (
                            <div
                              key={`${cluster.anchorId}-${item.ark}`}
                              className={rowClasses.join(' ')}
                              data-agent-id={item.id}
                              data-agent-ark={item.ark}
                              onClick={() => {
                                if (itemRecord) handleRowClick(itemRecord)
                              }}
                              onContextMenu={event => {
                                if (!itemRecord) return
                                event.preventDefault()
                                setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: itemRecord })
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={item.status === 'accepted'}
                                onChange={event => setClusterItemStatus(cluster.anchorId, item.ark, event.target.checked ? 'accepted' : 'rejected')}
                                onDoubleClick={event => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  removeClusterItem(cluster.anchorId, item.ark)
                                }}
                              />
                              <span className="entity-title">{item.label || item.ark}</span>
                              <span className="entity-id">{item.ark}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {!sortedEntries.length ? <em>{t('messages.noAgents', { defaultValue: 'No agents found.' })}</em> : null}
              </div>
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

function buildAgentClusters(records: RecordRow[], getLabel: (r: RecordRow) => string): AgentCluster[] {
  const byArk = new Map<string, RecordRow>()
  records.forEach(rec => {
    if (rec.ark) byArk.set(rec.ark, rec)
  })

  const clusters: AgentCluster[] = []

  for (const record of records) {
    const zones = findZones(record.intermarc, '90F')
    const items: AgentClusterItem[] = []
    for (const zone of zones) {
      const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim().toLowerCase()
      if (note !== 'clusterisation manuelle') continue
      const targetArk = zone.sousZones.find(sz => sz.code === '90F$3')?.valeur
      if (!targetArk) continue
      const target = byArk.get(targetArk)
      items.push({
        ark: targetArk,
        id: target?.id,
        label: target ? getLabel(target) : targetArk,
        status: 'accepted',
      })
    }
    if (items.length) {
      clusters.push({
        anchorId: record.id,
        anchorArk: record.ark,
        anchorLabel: getLabel(record) || record.id,
        items,
      })
    }
  }

  return clusters
}

function mergeAgentClusters(base: AgentCluster[], current: AgentCluster[]): AgentCluster[] {
  const currentByAnchor = new Map(current.map(cluster => [cluster.anchorId, cluster]))
  const next: AgentCluster[] = []

  for (const cluster of base) {
    const existing = currentByAnchor.get(cluster.anchorId)
    const mergedItems = mergeAgentClusterItems(cluster.items, existing?.items ?? [])
    next.push({ ...cluster, items: mergedItems })
    currentByAnchor.delete(cluster.anchorId)
  }

  for (const leftover of currentByAnchor.values()) {
    const keptItems = leftover.items.filter(item => item.status === 'rejected')
    if (keptItems.length) {
      next.push({ ...leftover, items: keptItems })
    }
  }

  return next
}

function mergeAgentClusterItems(base: AgentClusterItem[], existing: AgentClusterItem[]): AgentClusterItem[] {
  const existingByArk = new Map(existing.map(item => [item.ark, item]))
  const merged: AgentClusterItem[] = base.map(item => {
    const previous = existingByArk.get(item.ark)
    return previous ? { ...item, status: previous.status } : item
  })

  for (const item of existing) {
    if (!base.some(candidate => candidate.ark === item.ark) && item.status === 'rejected') {
      merged.push(item)
    }
  }

  return merged
}

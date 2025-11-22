import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { AgentTabState, WorkspaceTabStateWorkspace } from '../workspace/types'
import type { RecordRow } from '../types'
import { useAgentData, isAgentRecord } from './useAgentData'
import { useTranslation } from '../hooks/useTranslation'
import { useAppData } from '../providers/AppDataContext'
import { buildLabelFromIntermarc, findZones, addManualAgent90FEntries, type Intermarc } from '../lib/intermarc'
import { IntermarcView } from '../components/IntermarcView'
import { IntermarcEditor } from '../components/IntermarcEditor'
import { BacklinksPanel } from '../components/BacklinksPanel'
import { useBacklinks } from '../hooks/useBacklinks'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { WorkspaceContextMenu } from '../components/WorkspaceContextMenu'
import { EntityLabel } from '../components/EntityLabel'
import { configureTabStateForRecord } from '../workspace/tabState'
import { useWorkspaceData } from '../workspace/useWorkspaceData'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'
import { useToast } from '../providers/ToastContext'
import { agentTitleSegments } from '../core/entities'

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
  const { showToast } = useToast()
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
  const [pendingClusterSourceId, setPendingClusterSourceId] = useState<string | null>(null)
  const [pendingClusterTarget, setPendingClusterTarget] = useState<{
    anchorId: string
    sourceId: string
  } | null>(null)

  useEffect(() => {
    setAgentClusters(baseAgentClusters)
  }, [baseAgentClusters])

  const manualClusterIndex = useMemo(
    () => buildManualAgentClusterIndex(agentClusters),
    [agentClusters],
  )

  const pendingSourceRecord = useMemo(
    () => (pendingClusterSourceId ? getById(pendingClusterSourceId) : null),
    [getById, pendingClusterSourceId],
  )

  const sameAgentKind = useCallback((a: RecordRow | null, b: RecordRow | null) => {
    if (!a || !b) return false
    const norm = (record: RecordRow) => record.typeNorm?.toLowerCase().trim()
    return norm(a) === norm(b)
  }, [])

  const handleIntermarcSave = useCallback(
    (record: RecordRow, next: Intermarc) => {
      const typeNormalized = record.typeNorm?.toLowerCase() ?? ''
      const isAgent =
        typeNormalized === 'identite publique de personne' ||
        typeNormalized === 'collectivite' ||
        typeNormalized === 'famille'

      if (!isAgent) {
        updateRecordIntermarc(record.id, next)
        return
      }

      if (pendingClusterSourceId && pendingClusterSourceId !== record.id) {
        const pendingRecord = getById(pendingClusterSourceId)
        if (pendingRecord) {
          const pendingArk = pendingRecord.ark
          const targets = extractManualAgentTargets(next)
          if (pendingArk && targets.includes(pendingArk)) {
            throw new Error(
              t('agents.cluster.pendingAlreadySelected', {
                defaultValue: 'Impossible : cet agent est marqué pour un autre rattachement.',
              }),
            )
          }
        }
      }

      const targets = extractManualAgentTargets(next)
      const conflicts: string[] = []
      for (const target of targets) {
        const conflict = manualClusterIndex.get(target)
        if (conflict && conflict.anchorId !== record.id) {
          const label = conflict.anchorLabel || conflict.anchorId
          conflicts.push(`${target} (ancré sur ${label})`)
        }
        const targetRecord = getByArk(target) || getById(target.replace(/^ark:\//, '')) || null
        if (isManualAnchor(targetRecord)) {
          conflicts.push(
            t('agents.cluster.targetIsAnchor', {
              defaultValue: 'Impossible : une cible est déjà ancre d’un cluster manuel.',
            }),
          )
        }
      }

      if (conflicts.length) {
        throw new Error(
          `Impossible d'enregistrer : ces agents sont déjà rattachés à un autre cluster : ${conflicts.join(', ')}`,
        )
    }

      updateRecordIntermarc(record.id, next)
    },
    [manualClusterIndex, updateRecordIntermarc, getByArk, getById, pendingClusterSourceId, t],
  )

  const persistManualAgentCluster = useCallback(
    (anchorId: string, items: AgentClusterItem[]) => {
      const anchorRecord = getById(anchorId)
      if (!anchorRecord) return
      const entries = items.map(item => ({ ark: item.ark }))
      const nextIntermarc = addManualAgent90FEntries(anchorRecord.intermarc, entries)
      updateRecordIntermarc(anchorRecord.id, nextIntermarc)
    },
    [getById, updateRecordIntermarc],
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

  const cancelPendingCluster = useCallback(() => {
    setPendingClusterSourceId(prev => (prev ? null : prev))
    setPendingClusterTarget(null)
  }, [])

  const confirmPendingCluster = useCallback(() => {
    if (!pendingClusterTarget) return
    const source = getById(pendingClusterTarget.sourceId)
    const anchor = getById(pendingClusterTarget.anchorId)
    if (!source || !anchor) {
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }
    if (isManualAnchor(source)) {
      showToast(
        t('agents.cluster.targetIsAnchor', {
          defaultValue: 'Impossible : cet agent est déjà ancre d’un cluster manuel.',
        }),
        { tone: 'error' },
      )
      setPendingClusterTarget(null)
      setPendingClusterSourceId(null)
      return
    }
    if (!sameAgentKind(source, anchor)) {
      showToast(t('agents.cluster.typeMismatch', { defaultValue: 'Les agents doivent être du même type.' }), { tone: 'error' })
      setPendingClusterTarget(null)
      return
    }
    if (!source.ark) {
      showToast(t('agents.cluster.missingArk', { defaultValue: "Impossible de clustériser : l'agent n'a pas d'ARK." }), {
        tone: 'error',
      })
      setPendingClusterTarget(null)
      return
    }
    const sourceArk = source.ark

    setAgentClusters(prev => {
      let found = false
      const next = prev.map(cluster => {
        if (cluster.anchorId !== anchor.id) return cluster
        found = true
        const existing = cluster.items.some(item => item.ark === sourceArk)
        const items = existing ? cluster.items : [...cluster.items, { ark: sourceArk, id: source.id, label: buildAgentLabel(source) }]
        return { ...cluster, items }
      })
      if (!found) {
        next.push({
          anchorId: anchor.id,
          anchorArk: anchor.ark,
          anchorLabel: buildAgentLabel(anchor) || anchor.id,
          items: [{ ark: sourceArk, id: source.id, label: buildAgentLabel(source) }],
        })
      }
      return next
    })

    const anchorItems =
      agentClusters.find(c => c.anchorId === anchor.id)?.items ?? []
    const merged = anchorItems.some(item => item.ark === sourceArk)
      ? anchorItems
      : [...anchorItems, { ark: sourceArk, id: source.id, label: buildAgentLabel(source) }]
    persistManualAgentCluster(anchor.id, merged)
    setPendingClusterSourceId(null)
    setPendingClusterTarget(null)
    showToast(t('agents.cluster.success', { defaultValue: 'Agent ajouté au cluster.' }), { tone: 'success' })
  }, [agentClusters, buildAgentLabel, getById, pendingClusterTarget, persistManualAgentCluster, sameAgentKind, showToast, t])

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

  const prepareForClustering = useCallback(
    (record: RecordRow) => {
      if (isManualAnchor(record)) {
        showToast(
          t('agents.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cet agent est déjà ancre d’un cluster manuel.',
          }),
          { tone: 'error' },
        )
        setContextMenu(null)
        return
      }
      if (record.ark) {
        const conflict = manualClusterIndex.get(record.ark)
        if (conflict) {
          showToast(
            t('agents.cluster.pendingAlreadySelected', {
              defaultValue: 'Impossible : cet agent est déjà rattaché au cluster de {{anchor}}.',
              anchor: conflict.anchorLabel || conflict.anchorId,
            }),
            { tone: 'error' },
          )
          setContextMenu(null)
          return
        }
      }
      setPendingClusterSourceId(record.id)
      setContextMenu(null)
      showToast(t('agents.cluster.prepared', { defaultValue: 'Agent mis en attente pour un clustering.' }), {
        tone: 'info',
      })
    },
    [manualClusterIndex, showToast, t],
  )

  const requestClusterWith = useCallback(
    (anchor: RecordRow) => {
      if (!pendingSourceRecord || !sameAgentKind(anchor, pendingSourceRecord)) return
      if (isManualAnchor(pendingSourceRecord)) {
        showToast(
          t('agents.cluster.targetIsAnchor', {
            defaultValue: 'Impossible : cet agent est déjà ancre d’un cluster manuel.',
          }),
          { tone: 'error' },
        )
        setPendingClusterSourceId(null)
        return
      }
      setPendingClusterTarget({ anchorId: anchor.id, sourceId: pendingSourceRecord.id })
      setContextMenu(null)
    },
    [pendingSourceRecord, sameAgentKind, showToast, t],
  )

  const renderRow = (record: RecordRow) => {
    const classes = ['entity-row', 'entity-row--person']
    if (record.typeNorm === 'collectivite') classes.push('entity-row--collective')
    if (record.typeNorm === 'famille') classes.push('entity-row--person')
    if (state.selectedAgentId === record.id) classes.push('selected')
    if (pendingClusterSourceId === record.id) classes.push('pending-cluster-source')
    const label = buildLabelFromIntermarc(record.intermarc, record.type) || record.id
    const segments = agentTitleSegments(record)
    const counts = backlinkCounts(record)
    const pillType: EntityBadgeSpec['type'] =
      record.typeNorm === 'collectivite'
        ? 'collective'
        : record.typeNorm === 'famille'
          ? 'family'
          : 'person'
    const badges: EntityBadgeSpec[] = [{ type: pillType, text: record.id, tooltip: record.ark ?? record.id }]

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
        onDoubleClick={() => {
          if (pendingClusterSourceId === record.id) cancelPendingCluster()
        }}
        onContextMenu={e => {
          e.preventDefault()
          setContextMenu({ position: { x: e.clientX, y: e.clientY }, record })
        }}
      >
        <EntityLabel title={label} titleSegments={segments} badges={badges} counts={counts} />
        {clustered ? <span className="entity-cluster-flag">🍇</span> : null}
      </div>
    )
  }

  const collator = useMemo(() => new Intl.Collator('fr', { sensitivity: 'accent' }), [])

  const backlinkCounts = useCallback(
    (record: RecordRow): Partial<Record<'works' | 'expressions' | 'manifestations', number>> => {
      const backlinks = getBacklinksForRecord(record)
      let works = 0
      let expressions = 0
      let manifestations = 0
      backlinks.forEach(entry => {
        const type = entry.record.typeNorm.toLowerCase()
        if (type === 'oeuvre' || type === 'work') works += 1
        else if (type === 'expression') expressions += 1
        else if (type === 'manifestation') manifestations += 1
      })
      return { works, expressions, manifestations }
    },
    [getBacklinksForRecord],
  )

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
                  if (pendingClusterSourceId === cluster.anchorId) anchorClasses.push('pending-cluster-source')

                  return (
                    <div key={`cluster-${cluster.anchorId}`} className={clusterClasses.join(' ')} data-cluster-anchor-id={cluster.anchorId}>
                      <div
                        className={anchorClasses.join(' ')}
                        data-agent-id={cluster.anchorId}
                        data-agent-ark={cluster.anchorArk}
                        onClick={() => {
                          if (anchorRecord) handleRowClick(anchorRecord)
                        }}
                        onDoubleClick={() => {
                          if (pendingClusterSourceId === cluster.anchorId) cancelPendingCluster()
                        }}
                        onContextMenu={event => {
                          if (!anchorRecord) return
                          event.preventDefault()
                          setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: anchorRecord })
                        }}
                      >
                        <div className="cluster-header">
                          <span className="cluster-anchor-marker">⚓︎</span>
                          {anchorRecord ? (
                            <EntityLabel
                              title={cluster.anchorLabel || cluster.anchorId}
                              titleSegments={agentTitleSegments(anchorRecord)}
                              badges={[
                                {
                                  type:
                                    anchorRecord.typeNorm === 'collectivite'
                                      ? 'collective'
                                      : anchorRecord.typeNorm === 'famille'
                                        ? 'family'
                                        : 'person',
                                  text: anchorRecord.id,
                                  tooltip: anchorRecord.ark ?? anchorRecord.id,
                                } satisfies EntityBadgeSpec,
                              ]}
                              counts={backlinkCounts(anchorRecord)}
                            />
                          ) : (
                            <span className="entity-title">{cluster.anchorLabel || cluster.anchorId}</span>
                          )}
                        </div>
                      </div>
                      <div className="cluster-items">
                        {cluster.items.map(item => {
                          const itemRecord = item.id ? getById(item.id) : null
                          const rowClasses = ['cluster-item', 'entity-row', 'entity-row--person']
                          if (itemRecord && state.selectedAgentId === itemRecord.id) rowClasses.push('selected')
                          if (pendingClusterSourceId === item.id) rowClasses.push('pending-cluster-source')

                          return (
                            <div
                              key={`${cluster.anchorId}-${item.ark}`}
                              className={rowClasses.join(' ')}
                              data-agent-id={item.id}
                              data-agent-ark={item.ark}
                              onClick={() => {
                                if (itemRecord) handleRowClick(itemRecord)
                              }}
                              onDoubleClick={() => {
                                if (pendingClusterSourceId === item.id) cancelPendingCluster()
                              }}
                              onContextMenu={event => {
                                if (!itemRecord) return
                                event.preventDefault()
                                setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: itemRecord })
                              }}
                            >
                              <input
                                type="checkbox"
                                checked
                                onChange={event => {
                                  if (!event.target.checked) {
                                    removeClusterItem(cluster.anchorId, item.ark)
                                  }
                                }}
                                onDoubleClick={event => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  removeClusterItem(cluster.anchorId, item.ark)
                                }}
                              />
                              {itemRecord ? (
                                <EntityLabel
                                  title={item.label || item.ark}
                                  titleSegments={agentTitleSegments(itemRecord)}
                                  badges={[
                                    {
                                      type:
                                        itemRecord.typeNorm === 'collectivite'
                                          ? 'collective'
                                          : itemRecord.typeNorm === 'famille'
                                            ? 'family'
                                            : 'person',
                                      text: itemRecord.id,
                                      tooltip: itemRecord.ark ?? itemRecord.id,
                                    } satisfies EntityBadgeSpec,
                                  ]}
                                  counts={backlinkCounts(itemRecord)}
                                />
                              ) : (
                                <>
                                  <span className="entity-title">{item.label || item.ark}</span>
                                  <span className="entity-id">{item.ark}</span>
                                </>
                              )}
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
                    onSave={next => handleIntermarcSave(selectedRecord, next)}
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
          extraActionLabel={
            !pendingSourceRecord
              ? t('agents.cluster.prepare', { defaultValue: 'Préparer pour clustering' })
              : pendingSourceRecord.id !== contextMenu.record.id &&
                  sameAgentKind(pendingSourceRecord, contextMenu.record)
                ? t('agents.cluster.clusterWith', { defaultValue: 'Clustériser avec la sélection' })
                : undefined
          }
          extraActionDisabled={
            Boolean(
              pendingSourceRecord &&
                pendingSourceRecord.id !== contextMenu.record.id &&
                !sameAgentKind(pendingSourceRecord, contextMenu.record),
            )
          }
          onExtraAction={() => {
            if (!pendingSourceRecord) {
              prepareForClustering(contextMenu.record)
            } else if (
              pendingSourceRecord.id !== contextMenu.record.id &&
              sameAgentKind(pendingSourceRecord, contextMenu.record)
            ) {
              requestClusterWith(contextMenu.record)
            }
          }}
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
      {pendingClusterTarget ? (
        <ConfirmClusterModal
          source={getById(pendingClusterTarget.sourceId) ?? null}
          anchor={getById(pendingClusterTarget.anchorId) ?? null}
          onConfirm={confirmPendingCluster}
          onCancel={() => setPendingClusterTarget(null)}
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
    const targets = extractManualAgentTargets(record.intermarc)
    const items: AgentClusterItem[] = targets.map(targetArk => {
      const target = byArk.get(targetArk)
      return {
        ark: targetArk,
        id: target?.id,
        label: target ? getLabel(target) : targetArk,
      }
    })
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

function extractManualAgentTargets(im: Intermarc): string[] {
  const zones = findZones(im, '90F')
  const targets = new Set<string>()
  for (const zone of zones) {
    const noteRaw = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur
    if (!noteRaw || noteRaw.trim().toLowerCase() !== 'clusterisation manuelle') continue
    const target = zone.sousZones.find(sz => sz.code === '90F$3')?.valeur?.trim()
    if (target) targets.add(target)
  }
  return [...targets]
}

function buildManualAgentClusterIndex(clusters: AgentCluster[]): Map<string, AgentCluster> {
  const index = new Map<string, AgentCluster>()
  clusters.forEach(cluster => {
    cluster.items.forEach(item => {
      if (!index.has(item.ark)) {
        index.set(item.ark, cluster)
      }
    })
  })
  return index
}

function isManualAnchor(record: RecordRow | null): boolean {
  if (!record) return false
  const zones = findZones(record.intermarc, '90F')
  for (const zone of zones) {
    const note = zone.sousZones.find(sz => sz.code === '90F$q')?.valeur?.trim().toLowerCase()
    if (note !== 'clusterisation manuelle') continue
    const flags: string[] = [
      zone.affectedByCuration,
      ...zone.sousZones.map(sz => sz.affectedByCuration),
    ].filter((f): f is string => typeof f === 'string' && f.length > 0)
    for (const flag of flags) {
      const norm = flag.toLowerCase()
      if (norm === 'created' || norm === 'manual') return true
    }
  }
  return false
}

type ConfirmClusterModalProps = {
  source: RecordRow | null
  anchor: RecordRow | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmClusterModal({ source, anchor, onConfirm, onCancel }: ConfirmClusterModalProps) {
  const { t } = useTranslation()
  if (!source || !anchor) return null

  const sourceLabel = buildLabelFromIntermarc(source.intermarc, source.type) || source.id
  const anchorLabel = buildLabelFromIntermarc(anchor.intermarc, anchor.type) || anchor.id

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{t('agents.cluster.confirmTitle', { defaultValue: 'Confirmer la clusterisation' })}</h3>
        <p>
          {t('agents.cluster.confirmBody', {
            defaultValue: 'Rattacher « {{source}} » ({{sourceArk}}) au cluster de « {{anchor}} » ({{anchorArk}}) ?',
            source: sourceLabel,
            anchor: anchorLabel,
            sourceArk: source.ark ?? source.id,
            anchorArk: anchor.ark ?? anchor.id,
          })}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t('buttons.cancel', { defaultValue: 'Annuler' })}
          </button>
          <button type="button" className="workspace-side-toolbar__button--primary" onClick={onConfirm}>
            {t('buttons.confirm', { defaultValue: 'Confirmer' })}
          </button>
        </div>
      </div>
    </div>
  )
}

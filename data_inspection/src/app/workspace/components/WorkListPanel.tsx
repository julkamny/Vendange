import { useEffect, useMemo, useRef, useState, type MouseEvent, type UIEvent } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { WorkClusterDto, WorkListRowDto } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { EntityLabel } from '../../components/EntityLabel'
import { buildArkAndIdSets, normalizeArk as normalizeArkValue } from '../../lib/arkFilters'

type WorkListPanelProps = {
  clusters: WorkClusterDto[]
  unclusteredWorks: WorkListRowDto[]
  state: WorkspaceTabStateWorkspace
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; workId?: string | null; accepted: boolean }) => void
  pendingClusterSourceId?: string | null
  onCancelPendingCluster?: () => void
  onScroll?: (event: UIEvent<HTMLElement>) => void
  listRef?: React.MutableRefObject<HTMLElement | null>
  workArkFilter?: string[] | null
}

export function WorkListPanel({
  clusters,
  unclusteredWorks,
  state,
  onSelectWork,
  onOpenExpressions,
  onToggleWork,
  pendingClusterSourceId,
  onCancelPendingCluster,
  onScroll,
  listRef,
  workArkFilter,
}: WorkListPanelProps) {
  const { t } = useTranslation()
  const pickMediaKinds = (summary?: { mediaKinds?: unknown; media_kinds?: unknown }) =>
    (summary?.mediaKinds as unknown as { emoji: string; label: string; kindCode: string }[] | undefined) ??
    (summary?.media_kinds as unknown as { emoji: string; label: string; kindCode: string }[] | undefined)

  const { arks: filterSet, ids: filterIdSet, key: filterKey } = useMemo(
    () => buildArkAndIdSets(workArkFilter ?? null),
    [workArkFilter],
  )
  const filterActive = filterSet.size > 0 || filterIdSet.size > 0
  const [expandedOutOfScopeClusters, setExpandedOutOfScopeClusters] = useState<Set<string>>(new Set())
  const [expandedOutOfScopeWorks, setExpandedOutOfScopeWorks] = useState<Set<string>>(new Set())

  useEffect(() => {
    setExpandedOutOfScopeClusters(new Set())
    setExpandedOutOfScopeWorks(new Set())
  }, [filterKey])

  const clusterMeta = useMemo(() => {
    const map = new Map<string, { hasMatch: boolean; matchedArks: Set<string> }>()
    clusters.forEach(cluster => {
      const normalizedArks: string[] = []
      if (cluster.anchor_ark) {
        const n = normalizeArkValue(cluster.anchor_ark)
        if (n) normalizedArks.push(n)
      }
      if (cluster.anchor_id != null) {
        normalizedArks.push(String(cluster.anchor_id))
      }
      cluster.items.forEach(item => {
        const n = normalizeArkValue(item.ark)
        if (n) normalizedArks.push(n)
        if (item.id != null) normalizedArks.push(String(item.id))
      })
      const matched = filterActive
        ? normalizedArks.filter(ark => filterSet.has(ark) || filterIdSet.has(ark))
        : []
      map.set(cluster.anchor_id, {
        hasMatch: filterActive ? matched.length > 0 : true,
        matchedArks: new Set(matched),
      })
    })
    return map
  }, [clusters, filterActive, filterIdSet, filterSet])

  const sortedEntries = useMemo(() => {
    type ListEntry =
      | { kind: 'cluster'; cluster: WorkClusterDto }
      | { kind: 'unclustered'; work: WorkListRowDto }
    return [
      ...clusters.map(cluster => ({ kind: 'cluster', cluster }) as const),
      ...unclusteredWorks.map(work => ({ kind: 'unclustered', work }) as const),
    ] as ListEntry[]
  }, [clusters, unclusteredWorks])

  const isEmpty = !clusters.length && !unclusteredWorks.length

  const shouldIgnoreAgentBadge = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    return !!target?.closest('.agent-badge')
  }

  const shouldIgnoreWorkRowEvent = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    return !!target?.closest('input, button, .agent-badge')
  }

  const virtuosoRef = useRef<VirtuosoHandle | null>(null)

  useEffect(() => {
    if (!listRef) return
    const node = (virtuosoRef.current as unknown as { scroller?: HTMLElement } | null)?.scroller
    if (node) listRef.current = node
  }, [listRef])

  useEffect(() => {
    if (!listRef?.current) return
    if (Math.abs(listRef.current.scrollTop - state.listScrollTop) > 1) {
      listRef.current.scrollTop = state.listScrollTop
    }
  }, [listRef, state.listScrollTop, sortedEntries.length])

  useEffect(() => {
    const targetId =
      state.highlightedWorkId ??
      (state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null)
    const targetArk =
      state.highlightedWorkArk ??
      (state.selectedEntity?.entityType === 'work' ? state.selectedEntity.workArk ?? null : null)

    if (!targetId && !targetArk) return

    const index = sortedEntries.findIndex(entry => {
      if (entry.kind === 'cluster') {
        const { cluster } = entry
        if ((targetId && cluster.anchor_id === targetId) || (targetArk && cluster.anchor_ark === targetArk)) return true
        return cluster.items.some(item => (targetId && item.id === targetId) || (targetArk && item.ark === targetArk))
      }
      return (targetId && entry.work.id === targetId) || (targetArk && entry.work.ark === targetArk)
    })
    if (index < 0) return
    virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' })
    window.requestAnimationFrame(() => {
      const container = listRef?.current
      if (!container) return
      const selectors: string[] = []
      if (targetId) selectors.push(`[data-work-id="${targetId}"]`)
      if (targetArk) selectors.push(`[data-work-ark="${targetArk}"]`)
      if (!selectors.length) return
      const row = container.querySelector<HTMLElement>(selectors.join(','))
      if (row) row.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [listRef, sortedEntries, state.highlightedWorkArk, state.highlightedWorkId, state.selectedEntity])

  return (
    isEmpty ? (
      <em>{t('messages.noClusters', { defaultValue: 'No clusters yet.' })}</em>
    ) : (
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%', width: '100%' }}
        className="work-list-panel"
        data={sortedEntries}
        scrollerRef={
          listRef
            ? (node) => {
              if (node) listRef.current = node
            }
            : undefined
        }
        onScroll={(e) => onScroll?.(e as unknown as UIEvent<HTMLElement>)}
        itemContent={(_, entry) => {
          if (entry.kind === 'cluster') {
            const { cluster } = entry
            const anchorCounts = cluster.anchor_summary?.counts
            const anchorLabel = cluster.anchor_title ?? cluster.anchor_id
            const meta = clusterMeta.get(cluster.anchor_id)
            const anchorNormalized = normalizeArkValue(cluster.anchor_ark)
            const anchorIsMatch =
              anchorNormalized ? filterSet.has(anchorNormalized) : filterIdSet.has(String(cluster.anchor_id))
            const hasMatch = meta?.hasMatch ?? true
            const isOutOfScope = filterActive && !hasMatch
            const isExpanded = isOutOfScope && expandedOutOfScopeClusters.has(cluster.anchor_id)
            const clusterClasses = ['cluster']
            if (state.activeWorkAnchorId === cluster.anchor_id) clusterClasses.push('active')
            if (isOutOfScope) clusterClasses.push('cluster--out-of-scope')
            if (isOutOfScope && !isExpanded) clusterClasses.push('cluster--collapsed')
            const anchorRowClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
            if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchor_id) anchorRowClasses.push('pending-cluster-source')
            const anchorHighlighted =
              (state.highlightedWorkId && state.highlightedWorkId === cluster.anchor_id) ||
              (state.highlightedWorkArk && state.highlightedWorkArk === cluster.anchor_ark)
            if (anchorHighlighted) {
              anchorRowClasses.push('highlight')
            }
            if (isOutOfScope) anchorRowClasses.push('entity-row--out-of-scope')
            if (anchorIsMatch) anchorRowClasses.push('entity-row--filter-match')
            const anchorSegments =
              cluster.anchor_title_segments && cluster.anchor_title_segments.length
                ? cluster.anchor_title_segments
                : undefined
            const anchorMediaKinds = pickMediaKinds(cluster.anchor_summary)
            const anchorRelationships = cluster.anchor_summary?.relationships
            return (
              <div key={cluster.anchor_id} className={clusterClasses.join(' ')} data-cluster-anchor-id={cluster.anchor_id}>
                <div
                  className={anchorRowClasses.join(' ')}
                  data-work-id={cluster.anchor_id}
                  data-work-ark={cluster.anchor_ark}
                >
                  <div
                    className="cluster-header"
                    onClick={event => {
                      if (shouldIgnoreAgentBadge(event)) return
                      onSelectWork({ workId: cluster.anchor_id, workArk: cluster.anchor_ark })
                    }}
                    onDoubleClick={event => {
                      if (shouldIgnoreAgentBadge(event)) return
                      if (isOutOfScope) {
                        setExpandedOutOfScopeClusters(prev => {
                          const next = new Set(prev)
                          if (next.has(cluster.anchor_id)) next.delete(cluster.anchor_id)
                          else next.add(cluster.anchor_id)
                          return next
                        })
                        return
                      }
                      if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchor_id) {
                        onCancelPendingCluster?.()
                        return
                      }
                      onOpenExpressions({ workId: cluster.anchor_id, workArk: cluster.anchor_ark })
                    }}
                  >
                    <span className="cluster-anchor-marker">⚓︎</span>
                    <EntityLabel
                      title={anchorLabel}
                      badges={[{ type: 'work', text: cluster.anchor_id, tooltip: cluster.anchor_ark }]}
                      counts={anchorCounts}
                      relationships={anchorRelationships}
                      titleSegments={anchorSegments}
                      mediaKinds={anchorMediaKinds}
                    />
                  </div>
                  <button
                    type="button"
                    className="cluster-open-expressions"
                    onClick={event => {
                      event.stopPropagation()
                      onOpenExpressions({ workId: cluster.anchor_id, workArk: cluster.anchor_ark })
                    }}
                  >
                    {t('entity.viewExpressions', { defaultValue: 'Expressions' })}
                  </button>
                </div>
                <div className="cluster-items">
                  {cluster.items.map(item => {
                    const itemCounts = item.summary?.counts
                    const rowClasses = ['cluster-item', 'entity-row', 'entity-row--work']
                    if (!item.accepted) rowClasses.push('unchecked')
                    if (pendingClusterSourceId && pendingClusterSourceId === item.id) rowClasses.push('pending-cluster-source')
                    const itemHighlighted =
                      (state.highlightedWorkId && item.id && state.highlightedWorkId === item.id) ||
                      (state.highlightedWorkArk && state.highlightedWorkArk === item.ark)
                    if (itemHighlighted) {
                      rowClasses.push('highlight')
                    }
                    if (isOutOfScope) rowClasses.push('entity-row--out-of-scope')
                    const normalizedItemArk = normalizeArkValue(item.ark)
                    const itemIsMatch =
                      normalizedItemArk ? filterSet.has(normalizedItemArk) : filterIdSet.has(String(item.id ?? ''))
                    if (itemIsMatch) rowClasses.push('entity-row--filter-match')
                    const itemSegments = item.title_segments && item.title_segments.length ? item.title_segments : undefined
                    const mediaKinds = pickMediaKinds(item.summary)
                    const relationships = item.summary?.relationships
                    return (
                      <div
                        key={`${cluster.anchor_id}-${item.ark || item.id}`}
                        className={rowClasses.join(' ')}
                        data-work-id={item.id}
                        data-work-ark={item.ark}
                        onClick={event => {
                          if (shouldIgnoreWorkRowEvent(event)) return
                          onSelectWork({ workId: item.id || '', workArk: item.ark })
                        }}
                        onDoubleClick={event => {
                          if (shouldIgnoreWorkRowEvent(event)) return
                          if (isOutOfScope) {
                            setExpandedOutOfScopeClusters(prev => {
                              const next = new Set(prev)
                              if (next.has(cluster.anchor_id)) next.delete(cluster.anchor_id)
                              else next.add(cluster.anchor_id)
                              return next
                            })
                            return
                          }
                          if (pendingClusterSourceId && pendingClusterSourceId === item.id) {
                            onCancelPendingCluster?.()
                            return
                          }
                          onOpenExpressions({ workId: cluster.anchor_id, workArk: item.ark })
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={item.accepted}
                          onChange={event =>
                          onToggleWork({
                            clusterId: cluster.anchor_id,
                            workArk: item.ark,
                            workId: item.id ?? null,
                            accepted: event.target.checked,
                          })
                          }
                        />
                        <EntityLabel
                          title={item.title || item.id || item.ark || t('labels.workFallback')}
                          badges={item.id ? [{ type: 'work', text: item.id, tooltip: item.ark }] : undefined}
                          counts={itemCounts}
                          agentNames={undefined}
                          relationships={relationships}
                          titleSegments={itemSegments}
                          mediaKinds={mediaKinds}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }

          const { work } = entry
          const isMatch = filterIdSet.has(String(work.id ?? ''))
          const isOutOfScope = filterActive && !isMatch
          const isExpanded = isOutOfScope && expandedOutOfScopeWorks.has(work.id)
          const containerClasses = ['cluster', 'cluster--unclustered']
          const headerClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
          if (isOutOfScope) {
            containerClasses.push('cluster--out-of-scope')
            if (!isExpanded) containerClasses.push('cluster--collapsed')
            headerClasses.push('entity-row--out-of-scope')
            if (!isExpanded) headerClasses.push('entity-row--collapsed')
          }
          if (isMatch) headerClasses.push('entity-row--filter-match')
          const highlight =
            (state.highlightedWorkId && state.highlightedWorkId === work.id) ||
            (work.ark && state.highlightedWorkArk === work.ark) ||
            (!work.ark && state.selectedEntity?.entityType === 'work' && state.selectedEntity.id === work.id)
          if (highlight) headerClasses.push('highlight')
          if (pendingClusterSourceId && pendingClusterSourceId === work.id) headerClasses.push('pending-cluster-source')
          const counts = work.summary?.counts
          const relationships = work.summary?.relationships
          const segments = work.title_segments && work.title_segments.length ? work.title_segments : undefined
          const mediaKinds = pickMediaKinds(work.summary)
          return (
            <div key={`unclustered-${work.id}`} className={containerClasses.join(' ')} data-work-id={work.id} data-work-ark={work.ark}>
              <div
                className={headerClasses.join(' ')}
                data-work-id={work.id}
                data-work-ark={work.ark}
                onClick={event => {
                  if (shouldIgnoreAgentBadge(event)) return
                  onSelectWork({ workId: work.id, workArk: work.ark })
                }}
                onDoubleClick={event => {
                  if (shouldIgnoreAgentBadge(event)) return
                  if (isOutOfScope) {
                    setExpandedOutOfScopeWorks(prev => {
                      const next = new Set(prev)
                      if (next.has(work.id)) next.delete(work.id)
                      else next.add(work.id)
                      return next
                    })
                    return
                  }
                  if (pendingClusterSourceId && pendingClusterSourceId === work.id) {
                    onCancelPendingCluster?.()
                    return
                  }
                  onOpenExpressions({ workId: work.id, workArk: work.ark })
                }}
              >
                <div className="cluster-header">
                  <EntityLabel
                    title={work.title || work.id || work.ark || t('labels.workFallback')}
                    badges={[{ type: 'work', text: work.id, tooltip: work.ark }]}
                    counts={counts}
                    agentNames={undefined}
                    relationships={relationships}
                    titleSegments={segments}
                    mediaKinds={mediaKinds}
                  />
                </div>
              </div>
            </div>
          )
        }}
      />
    )
  )
}

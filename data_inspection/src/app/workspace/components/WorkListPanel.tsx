import { useEffect, useMemo, useRef, type MouseEvent, type UIEvent } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { WorkClusterDto, WorkListRowDto } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { EntityLabel } from '../../components/EntityLabel'

type WorkListPanelProps = {
  clusters: WorkClusterDto[]
  unclusteredWorks: WorkListRowDto[]
  state: WorkspaceTabStateWorkspace
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; accepted: boolean }) => void
  pendingClusterSourceId?: string | null
  onCancelPendingCluster?: () => void
  onScroll?: (event: UIEvent<HTMLElement>) => void
  listRef?: React.MutableRefObject<HTMLElement | null>
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
}: WorkListPanelProps) {
  const { t } = useTranslation()
  const pickMediaKinds = (summary?: { mediaKinds?: unknown; media_kinds?: unknown }) =>
    (summary?.mediaKinds as unknown as { emoji: string; label: string; kindCode: string }[] | undefined) ??
    (summary?.media_kinds as unknown as { emoji: string; label: string; kindCode: string }[] | undefined)

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
      state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null
    const targetArk =
      state.highlightedWorkArk ??
      (state.selectedEntity?.entityType === 'work' ? state.selectedEntity.workArk ?? null : null)

    if (!targetId && !targetArk) return

    const index = sortedEntries.findIndex(entry => {
      if (entry.kind === 'cluster') {
        const { cluster } = entry
        if (cluster.anchor_id === targetId || cluster.anchor_ark === targetArk) return true
        return cluster.items.some(item => item.id === targetId || item.ark === targetArk)
      }
      return entry.work.id === targetId || entry.work.ark === targetArk
    })
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' })
    }
  }, [sortedEntries, state.highlightedWorkArk, state.selectedEntity])

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
            const clusterClasses = ['cluster']
            if (state.activeWorkAnchorId === cluster.anchor_id) clusterClasses.push('active')
            const anchorRowClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
            if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchor_id) anchorRowClasses.push('pending-cluster-source')
            if (state.highlightedWorkArk && state.highlightedWorkArk === cluster.anchor_ark) {
              anchorRowClasses.push('highlight')
            }
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
                      if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchor_id) {
                        onCancelPendingCluster?.()
                        return
                      }
                      onOpenExpressions({ workId: cluster.anchor_id, workArk: cluster.anchor_ark })
                    }}
                  >
                    <span className="cluster-anchor-marker">⚓︎</span>
                    <EntityLabel
                      title={entry.title}
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
                    if (state.highlightedWorkArk && state.highlightedWorkArk === item.ark) {
                      rowClasses.push('highlight')
                    }
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

          const { work, title } = entry
          const containerClasses = ['cluster', 'cluster--unclustered']
          const headerClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
          const highlight =
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
                  if (pendingClusterSourceId && pendingClusterSourceId === work.id) {
                    onCancelPendingCluster?.()
                    return
                  }
                  onOpenExpressions({ workId: work.id, workArk: work.ark })
                }}
              >
                <div className="cluster-header">
                  <EntityLabel
                    title={title}
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

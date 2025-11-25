import { useMemo, type MouseEvent, useCallback, type UIEvent } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { Cluster, RecordRow } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { computeWorkCounts, computeUnclusteredWorkCounts } from '../../core/workCounts'
import { titleOf, workTitleSegments } from '../../core/entities'
import { EntityLabel } from '../../components/EntityLabel'
import { useAppData } from '../../providers/AppDataContext'
import { useRecordLookup } from '../../hooks/useRecordLookup'
import { useBacklinks } from '../../hooks/useBacklinks'

type WorkListPanelProps = {
  clusters: Cluster[]
  unclusteredWorks: RecordRow[]
  state: WorkspaceTabStateWorkspace
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; accepted: boolean }) => void
  pendingClusterSourceId?: string | null
  onCancelPendingCluster?: () => void
  onScroll?: (event: UIEvent<HTMLElement>) => void
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
}: WorkListPanelProps) {
  const { t, language } = useTranslation()
  const { originalIndexes } = useAppData()
  const { getById, getByArk, getAgentNames, getGeneralRelationshipCount, getMediaKinds } =
    useRecordLookup()
  const { countIncomingRelationships } = useBacklinks()

  const resolveWorkSegments = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record = getById(id) ?? getByArk(ark)
      return record ? workTitleSegments(record) : undefined
    },
    [getByArk, getById],
  )

  const relationshipsFor = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record = getById(id) ?? getByArk(ark)
      const outgoing = getGeneralRelationshipCount(id, ark)
      const incoming = record ? countIncomingRelationships(record) : 0
      return { outgoing, incoming }
    },
    [countIncomingRelationships, getByArk, getById, getGeneralRelationshipCount],
  )

  const collator = useMemo(() => new Intl.Collator(language, { sensitivity: 'accent' }), [language])
  const sortedEntries = useMemo(() => {
    type ListEntry =
      | { kind: 'cluster'; cluster: Cluster; title: string }
      | { kind: 'unclustered'; work: RecordRow; title: string }

    const sanitizeTitle = (value: string | undefined, fallback: string) => {
      const trimmed = value?.trim()
      return trimmed && trimmed.length > 0 ? trimmed : fallback
    }

    const clusterEntries: ListEntry[] = clusters.map(cluster => ({
      kind: 'cluster',
      cluster,
      title: sanitizeTitle(cluster.anchorTitle, cluster.anchorId),
    }))
    const orphanEntries: ListEntry[] = unclusteredWorks.map(work => ({
      kind: 'unclustered',
      work,
      title: sanitizeTitle(titleOf(work), work.id),
    }))

    return [...clusterEntries, ...orphanEntries].sort((a, b) => {
      const comparison = collator.compare(a.title, b.title)
      if (comparison !== 0) return comparison
      if (a.kind === 'cluster' && b.kind === 'cluster') {
        return a.cluster.anchorId.localeCompare(b.cluster.anchorId)
      }
      if (a.kind === 'unclustered' && b.kind === 'unclustered') {
        return a.work.id.localeCompare(b.work.id)
      }
      return a.kind === 'cluster' ? -1 : 1
    })
  }, [clusters, unclusteredWorks, collator])

  if (!clusters.length && !unclusteredWorks.length) {
    return <em>{t('messages.noClusters', { defaultValue: 'No clusters yet.' })}</em>
  }

  const shouldIgnoreAgentBadge = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    return !!target?.closest('.agent-badge')
  }

  const shouldIgnoreWorkRowEvent = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    return !!target?.closest('input, button, .agent-badge')
  }

  return (
    <Virtuoso
      style={{ height: '100%', width: '100%' }}
      className="work-list-panel"
      data={sortedEntries}
      onScroll={(e) => onScroll?.(e as unknown as UIEvent<HTMLElement>)}
      itemContent={(_, entry) => {
        if (entry.kind === 'cluster') {
          const { cluster } = entry
          const anchorCounts = computeWorkCounts(cluster, cluster.anchorArk)
          const clusterClasses = ['cluster']
          if (state.activeWorkAnchorId === cluster.anchorId) clusterClasses.push('active')
          const anchorRowClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
          if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchorId) anchorRowClasses.push('pending-cluster-source')
          if (state.highlightedWorkArk && state.highlightedWorkArk === cluster.anchorArk) {
            anchorRowClasses.push('highlight')
          }
          const anchorAgentNames = getAgentNames(cluster.anchorId, cluster.anchorArk)
          const anchorSegments = resolveWorkSegments(cluster.anchorId, cluster.anchorArk)
          const anchorMediaKinds = getMediaKinds(cluster.anchorId, cluster.anchorArk)
          const anchorRelationships = relationshipsFor(cluster.anchorId, cluster.anchorArk)
          return (
            <div key={cluster.anchorId} className={clusterClasses.join(' ')} data-cluster-anchor-id={cluster.anchorId}>
              <div
                className={anchorRowClasses.join(' ')}
                data-work-id={cluster.anchorId}
                data-work-ark={cluster.anchorArk}
              >
                <div
                  className="cluster-header"
                  onClick={event => {
                    if (shouldIgnoreAgentBadge(event)) return
                    onSelectWork({ workId: cluster.anchorId, workArk: cluster.anchorArk })
                  }}
                  onDoubleClick={event => {
                    if (shouldIgnoreAgentBadge(event)) return
                    if (pendingClusterSourceId && pendingClusterSourceId === cluster.anchorId) {
                      onCancelPendingCluster?.()
                      return
                    }
                    onOpenExpressions({ workId: cluster.anchorId, workArk: cluster.anchorArk })
                  }}
                >
                  <span className="cluster-anchor-marker">⚓︎</span>
                  <EntityLabel
                    title={entry.title}
                    badges={[{ type: 'work', text: cluster.anchorId, tooltip: cluster.anchorArk }]}
                    counts={anchorCounts}
                    agentNames={anchorAgentNames}
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
                    onOpenExpressions({ workId: cluster.anchorId, workArk: cluster.anchorArk })
                  }}
                >
                  {t('entity.viewExpressions', { defaultValue: 'Expressions' })}
                </button>
              </div>
              <div className="cluster-items">
                {cluster.items.map(item => {
                  const itemCounts = computeWorkCounts(cluster, item.ark)
                  const rowClasses = ['cluster-item', 'entity-row', 'entity-row--work']
                  if (!item.accepted) rowClasses.push('unchecked')
                  if (pendingClusterSourceId && pendingClusterSourceId === item.id) rowClasses.push('pending-cluster-source')
                  if (state.highlightedWorkArk && state.highlightedWorkArk === item.ark) {
                    rowClasses.push('highlight')
                  }
                  const agentNames = getAgentNames(item.id, item.ark)
                  const itemSegments = resolveWorkSegments(item.id, item.ark)
                  const mediaKinds = getMediaKinds(item.id, item.ark)
                  const relationships = relationshipsFor(item.id, item.ark)
                  return (
                    <div
                      key={`${cluster.anchorId}-${item.ark || item.id}`}
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
                        onOpenExpressions({ workId: cluster.anchorId, workArk: item.ark })
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.accepted}
                        onChange={event =>
                          onToggleWork({
                            clusterId: cluster.anchorId,
                            workArk: item.ark,
                            accepted: event.target.checked,
                          })
                        }
                      />
                      <EntityLabel
                        title={item.title || item.id || item.ark || t('labels.workFallback')}
                        badges={item.id ? [{ type: 'work', text: item.id, tooltip: item.ark }] : undefined}
                        counts={itemCounts}
                        agentNames={agentNames}
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
        const counts = computeUnclusteredWorkCounts(work, originalIndexes ?? null)
        const agentNames = getAgentNames(work.id, work.ark)
        const relationships = relationshipsFor(work.id, work.ark)
        const segments = workTitleSegments(work)
        const mediaKinds = getMediaKinds(work.id, work.ark)
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
                  agentNames={agentNames}
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
}
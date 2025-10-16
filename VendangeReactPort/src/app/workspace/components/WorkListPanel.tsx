import { useMemo } from 'react'
import type { Cluster, RecordRow } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { computeWorkCounts } from '../../core/workCounts'
import { titleOf } from '../../core/entities'

type WorkListPanelProps = {
  clusters: Cluster[]
  unclusteredWorks: RecordRow[]
  state: WorkspaceTabState
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; accepted: boolean }) => void
}

export function WorkListPanel({ clusters, unclusteredWorks, state, onSelectWork, onOpenExpressions, onToggleWork }: WorkListPanelProps) {
  const { t, language } = useTranslation()

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

  return (
    <div className="work-list-panel">
      {sortedEntries.map(entry => {
        if (entry.kind === 'cluster') {
          const { cluster } = entry
          return (
            <article
              key={cluster.anchorId}
              className={`cluster-card${state.activeWorkAnchorId === cluster.anchorId ? ' is-active' : ''}`}
            >
              <header
                className="cluster-card__header"
                onClick={() => onSelectWork({ workId: cluster.anchorId, workArk: cluster.anchorArk })}
              >
                <h4>{entry.title}</h4>
                <span className="cluster-card__badge">
                  ⚓︎ {t('labels.workFallback', { defaultValue: 'Work' })}
                </span>
                <button
                  type="button"
                  className="cluster-card__expressions"
                  onClick={event => {
                    event.stopPropagation()
                    onOpenExpressions({ workId: cluster.anchorId, workArk: cluster.anchorArk })
                  }}
                >
                  {t('entity.viewExpressions', { defaultValue: 'Expressions' })}
                </button>
              </header>
              <ul>
                {cluster.items.map(item => {
                  const counts = computeWorkCounts(cluster, item.ark)
                  return (
                    <li key={`${cluster.anchorId}-${item.ark || item.id}`}>
                      <button
                        type="button"
                        className="cluster-item-btn"
                        onClick={() => onSelectWork({ workId: item.id || '', workArk: item.ark })}
                      >
                        <span>{item.title || item.id || item.ark}</span>
                        <span className="cluster-item-counts">
                          {counts.expressions}·{counts.manifestations}
                        </span>
                      </button>
                      <label className="cluster-item-toggle">
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
                        {item.accepted
                          ? t('labels.checkedLabel', { defaultValue: 'Kept' })
                          : t('labels.uncheckedLabel')}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </article>
          )
        }

        const { work, title } = entry
        return (
          <article
            key={`unclustered-${work.id}`}
            className={`cluster-card cluster-card--unclustered${
              state.activeWorkAnchorId === work.id ? ' is-active' : ''
            }`}
          >
            <header
              className="cluster-card__header"
              onClick={() => onSelectWork({ workId: work.id, workArk: work.ark })}
            >
              <h4>{title}</h4>
              <span className="cluster-card__badge">
                {t('labels.unclusteredWork', { defaultValue: 'Unclustered work' })}
              </span>
            </header>
          </article>
        )
      })}
    </div>
  )
}

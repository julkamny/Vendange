import type { Cluster, RecordRow } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { computeWorkCounts } from '../../core/workCounts'

type WorkListPanelProps = {
  clusters: Cluster[]
  unclusteredWorks: RecordRow[]
  state: WorkspaceTabState
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; accepted: boolean }) => void
}

export function WorkListPanel({ clusters, unclusteredWorks, state, onSelectWork, onOpenExpressions, onToggleWork }: WorkListPanelProps) {
  const { t } = useTranslation()

  if (!clusters.length && !unclusteredWorks.length) {
    return <em>{t('messages.noClusters', { defaultValue: 'No clusters yet.' })}</em>
  }

  return (
    <div className="work-list-panel">
      {clusters.map(cluster => (
        <article
          key={cluster.anchorId}
          className={`cluster-card${state.activeWorkAnchorId === cluster.anchorId ? ' is-active' : ''}`}
        >
          <header className="cluster-card__header" onClick={() => onSelectWork({ workId: cluster.anchorId, workArk: cluster.anchorArk })}>
            <h4>{cluster.anchorTitle || cluster.anchorId}</h4>
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
      ))}
      {unclusteredWorks.length > 0 && (
        <section className="unclustered-section">
          <h4>{t('labels.unclusteredWork', { defaultValue: 'Unclustered' })}</h4>
          <ul>
            {unclusteredWorks.map(work => (
              <li key={work.id}>
                <button
                  type="button"
                  className="cluster-item-btn"
                  onClick={() => onSelectWork({ workId: work.id, workArk: work.ark })}
                >
                  <span>{work.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

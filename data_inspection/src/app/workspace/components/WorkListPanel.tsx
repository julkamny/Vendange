import { useMemo, useState, type MouseEvent, type FormEvent } from 'react'
import type { Cluster, RecordRow } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { computeWorkCounts, computeUnclusteredWorkCounts } from '../../core/workCounts'
import { titleOf } from '../../core/entities'
import { EntityLabel } from '../../components/EntityLabel'
import { useAppData } from '../../providers/AppDataContext'
import { useRecordLookup } from '../../hooks/useRecordLookup'

type WorkListPanelProps = {
  clusters: Cluster[]
  unclusteredWorks: RecordRow[]
  state: WorkspaceTabState
  onSelectWork: (payload: { workId: string; workArk?: string | null }) => void
  onOpenExpressions: (payload: { workId: string; workArk?: string | null }) => void
  onToggleWork: (payload: { clusterId: string; workArk: string; accepted: boolean }) => void
}

export function WorkListPanel({
  clusters,
  unclusteredWorks,
  state,
  onSelectWork,
  onOpenExpressions,
  onToggleWork,
}: WorkListPanelProps) {
  const { t, language } = useTranslation()
  const { originalIndexes, addWorkToCluster } = useAppData()
  const { getAgentNames, getGeneralRelationshipCount, getByArk } = useRecordLookup()

  const [activeClusterAdd, setActiveClusterAdd] = useState<string | null>(null)
  const [clusterArkInput, setClusterArkInput] = useState('')
  const [clusterAddError, setClusterAddError] = useState<string | null>(null)

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

  const handleSubmitClusterAdd = (event: FormEvent<HTMLFormElement>, cluster: Cluster) => {
    event.preventDefault()
    const ark = clusterArkInput.trim()
    if (!ark) {
      setClusterAddError(t('messages.workArkRequired', { defaultValue: 'Enter a work ARK.' }))
      return
    }
    if (cluster.anchorArk === ark || cluster.items.some(item => item.ark === ark)) {
      setClusterAddError(t('messages.workAlreadyInCluster', { defaultValue: 'This work is already in the cluster.' }))
      return
    }
    const record = getByArk(ark)
    if (!record || record.typeNorm !== 'oeuvre') {
      setClusterAddError(
        t('messages.workArkNotFound', { defaultValue: 'No work was found for this ARK.' }),
      )
      return
    }
    const workArks = new Set<string>()
    if (cluster.anchorArk) workArks.add(cluster.anchorArk)
    cluster.items.forEach(item => {
      if (item.ark) workArks.add(item.ark)
    })
    const recordArk = record.ark || record.id
    if (workArks.has(recordArk)) {
      setClusterAddError(
        t('messages.workAlreadyInCluster', { defaultValue: 'This work is already in the cluster.' }),
      )
      return
    }
    addWorkToCluster(cluster.anchorId, ark)
    setActiveClusterAdd(null)
    setClusterArkInput('')
    setClusterAddError(null)
  }

  return (
    <div className="work-list-panel">
      {sortedEntries.map(entry => {
        if (entry.kind === 'cluster') {
          const { cluster } = entry
          const anchorCounts = computeWorkCounts(cluster, cluster.anchorArk)
          const clusterClasses = ['cluster']
          if (state.activeWorkAnchorId === cluster.anchorId) clusterClasses.push('active')
          const anchorRowClasses = ['cluster-header-row', 'entity-row', 'entity-row--work']
          if (state.highlightedWorkArk && state.highlightedWorkArk === cluster.anchorArk) {
            anchorRowClasses.push('highlight')
          }
          const anchorAgentNames = getAgentNames(cluster.anchorId, cluster.anchorArk)
          return (
            <div key={cluster.anchorId} className={clusterClasses.join(' ')} data-cluster-anchor-id={cluster.anchorId}>
              <div className="cluster-tools">
                <button
                  type="button"
                  className="cluster-add-button"
                  onClick={() => {
                    if (activeClusterAdd === cluster.anchorId) {
                      setActiveClusterAdd(null)
                      setClusterArkInput('')
                      setClusterAddError(null)
                    } else {
                      setActiveClusterAdd(cluster.anchorId)
                      setClusterArkInput('')
                      setClusterAddError(null)
                    }
                  }}
                  aria-expanded={activeClusterAdd === cluster.anchorId}
                  aria-label={t('labels.addWorkToCluster', { defaultValue: 'Add work to cluster' })}
                >
                  +
                </button>
                {activeClusterAdd === cluster.anchorId ? (
                  <form
                    className="cluster-add-form"
                    onSubmit={event => handleSubmitClusterAdd(event, cluster)}
                  >
                    <input
                      type="text"
                      value={clusterArkInput}
                      onChange={event => setClusterArkInput(event.target.value)}
                      placeholder={t('labels.workArkPlaceholder', { defaultValue: 'ark:/...' })}
                    />
                    <button type="submit">{t('buttons.add', { defaultValue: 'Add' })}</button>
                    <button
                      type="button"
                      className="cluster-add-cancel"
                      onClick={() => {
                        setActiveClusterAdd(null)
                        setClusterArkInput('')
                        setClusterAddError(null)
                      }}
                      aria-label={t('buttons.cancel', { defaultValue: 'Cancel' })}
                    >
                      ×
                    </button>
                    {clusterAddError ? <div className="form-error">{clusterAddError}</div> : null}
                  </form>
                ) : null}
              </div>
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
                    onOpenExpressions({ workId: cluster.anchorId, workArk: cluster.anchorArk })
                  }}
                >
                  <span className="cluster-anchor-marker">⚓︎</span>
                  <EntityLabel
                    title={entry.title}
                    subtitle={t('banners.anchorSubtitle')}
                    badges={[{ type: 'work', text: cluster.anchorId, tooltip: cluster.anchorArk }]}
                    counts={anchorCounts}
                    agentNames={anchorAgentNames}
                    relationshipsCount={getGeneralRelationshipCount(cluster.anchorId, cluster.anchorArk)}
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
                  if (state.highlightedWorkArk && state.highlightedWorkArk === item.ark) {
                    rowClasses.push('highlight')
                  }
                  const agentNames = getAgentNames(item.id, item.ark)
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
                        subtitle={item.accepted ? undefined : t('labels.uncheckedWork')}
                        badges={item.id ? [{ type: 'work', text: item.id, tooltip: item.ark }] : undefined}
                        counts={itemCounts}
                        agentNames={agentNames}
                        relationshipsCount={getGeneralRelationshipCount(item.id, item.ark)}
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
        const counts = computeUnclusteredWorkCounts(work, originalIndexes ?? null)
        const agentNames = getAgentNames(work.id, work.ark)
        const relationships = getGeneralRelationshipCount(work.id, work.ark)
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
                onOpenExpressions({ workId: work.id, workArk: work.ark })
              }}
            >
              <div className="cluster-header">
                <EntityLabel
                  title={title}
                  subtitle={t('labels.unclusteredWork', { defaultValue: 'Unclustered work' })}
                  badges={[{ type: 'work', text: work.id, tooltip: work.ark }]}
                  counts={counts}
                  agentNames={agentNames}
                  relationshipsCount={relationships}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

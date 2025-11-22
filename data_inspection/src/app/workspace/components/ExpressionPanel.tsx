import { useMemo, useCallback, type MouseEvent } from 'react'
import type { Cluster, ExpressionClusterItem, ExpressionItem } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { EntityPill, CountBadge, AgentBadge, RelationshipBadge } from '../../components/EntityLabel'
import { useRecordLookup } from '../../hooks/useRecordLookup'
import { countExpressionWorkLinks } from '../../core/entities'
import { useBacklinks } from '../../hooks/useBacklinks'
import type { MediaKind } from '../../core/media'

type ExpressionPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabStateWorkspace
  onSelectExpression: (payload: {
    expressionId: string
    expressionArk?: string
    workArk?: string
    anchorId?: string
  }) => void
  onToggleExpression: (payload: {
    anchorExpressionId: string
    expressionArk: string
    accepted: boolean
  }) => void
  onOpenManifestations: (payload: {
    expressionId: string
    expressionArk?: string
    workArk?: string
    anchorId?: string
  }) => void
  pendingClusterSourceId?: string | null
  onCancelPendingCluster?: () => void
}

type ExpressionGroupLabelProps = {
  expression: ExpressionItem | ExpressionClusterItem
  isAnchor: boolean
  manifestationCount: number
  workLinkCount: number
  agentNames: string[]
  relationships: { outgoing: number; incoming: number }
  mediaKinds?: MediaKind[]
}

export function ExpressionGroupLabel({
  expression,
  isAnchor,
  manifestationCount,
  workLinkCount,
  agentNames,
  relationships,
  mediaKinds,
}: ExpressionGroupLabelProps) {
  const label = expression.title || expression.id
  const tooltip = label?.trim()
  return (
    <span
      className={`entity-label expression-group-label${tooltip ? ' has-tooltip' : ''}`}
      data-tooltip={tooltip || undefined}
      aria-label={tooltip || undefined}
    >
      <span className="expression-marker">{isAnchor ? '⚓︎' : '🍇'}</span>
      <EntityPill type="expression" text={expression.id} tooltip={expression.ark} />
      {expression.workId ? <EntityPill type="work" text={expression.workId} tooltip={expression.workArk} /> : null}
      {manifestationCount > 0 ? <CountBadge kind="manifestations" count={manifestationCount} /> : null}
      {workLinkCount > 1 ? <CountBadge kind="workLinks" count={workLinkCount} /> : null}
      {relationships.outgoing > 0 || relationships.incoming > 0 ? (
        <RelationshipBadge outgoing={relationships.outgoing} incoming={relationships.incoming} />
      ) : null}
      {agentNames.length ? <AgentBadge names={agentNames} /> : null}
      {mediaKinds?.length ? (
        <span className="entity-media-emojis">
          {mediaKinds.map(kind => (
            <span
              key={kind.emoji}
              className="entity-media-emoji"
              role="img"
              aria-label={kind.label}
              title={kind.label}
            >
              {kind.emoji}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function matchesFilter(target?: string | null, filter?: string | null): boolean {
  if (!filter) return true
  if (!target) return false
  return target === filter
}

function shouldIgnoreAnchorEvent(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null
  return !!target?.closest('.agent-badge')
}

function shouldIgnoreExpressionEvent(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null
  return !!target?.closest('input, button, .agent-badge')
}

export function ExpressionPanel({
  cluster,
  state,
  onSelectExpression,
  onToggleExpression,
  onOpenManifestations,
  pendingClusterSourceId,
  onCancelPendingCluster,
}: ExpressionPanelProps) {
  const { t } = useTranslation()
  const { getById, getByArk, getAgentNames, getGeneralRelationshipCount, getMediaKinds } = useRecordLookup()
  const { countIncomingRelationships } = useBacklinks()
  const resolveExpressionRecord = useCallback(
    (id?: string | null, ark?: string | null) => getById(id) ?? getByArk(ark),
    [getByArk, getById],
  )

  const computeExpressionMetrics = useCallback(
    (id?: string | null, ark?: string | null) => {
      const record = resolveExpressionRecord(id, ark)
      const workLinkCount = record ? countExpressionWorkLinks(record) : 0
      const outgoing = getGeneralRelationshipCount(id, ark)
      const incoming = record ? countIncomingRelationships(record) : 0
      return { workLinkCount, relationships: { outgoing, incoming }, record }
    },
    [countIncomingRelationships, getGeneralRelationshipCount, resolveExpressionRecord],
  )

  const groups = useMemo(() => {
    if (!cluster) return []
    const base = cluster.expressionGroups
    const independents = (cluster.independentExpressions ?? []).map(expr => ({
      anchor: expr,
      clustered: [],
    }))
    return [...base, ...independents]
  }, [cluster])

  if (!cluster) return <em>{t('messages.noClusters')}</em>

  const highlightedWorkArk = state.highlightedWorkArk ?? null
  const highlightedExpressionArk = state.highlightedExpressionArk ?? null
  const selectedEntity = state.selectedEntity

  return (
    <div className="expression-groups">
      {groups.map(group => {
        const groupClasses = ['expression-group']
        if (state.activeExpressionAnchorId === group.anchor.id) groupClasses.push('active')

        const anchorClasses = ['expression-anchor', 'entity-row', 'entity-row--expression']
        if (pendingClusterSourceId && pendingClusterSourceId === group.anchor.id) anchorClasses.push('pending-cluster-source')
        const anchorAgentNames = getAgentNames(group.anchor.id, group.anchor.ark)
        const {
          workLinkCount: anchorWorkLinks,
          relationships: anchorRelationships,
        } = computeExpressionMetrics(group.anchor.id, group.anchor.ark)
        const anchorMediaKinds = getMediaKinds(group.anchor.id, group.anchor.ark)

        const anchorSelected =
          selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === group.anchor.id
        const anchorFromManifestation =
          selectedEntity?.entityType === 'manifestation' && selectedEntity.expressionId === group.anchor.id
        const anchorFromWork =
          selectedEntity?.entityType === 'work' && selectedEntity.workArk === group.anchor.workArk
        const anchorMatchesHighlight = matchesFilter(group.anchor.workArk, highlightedWorkArk)

        if (anchorSelected) anchorClasses.push('selected')
        else if (anchorFromManifestation || anchorFromWork || (highlightedWorkArk && anchorMatchesHighlight)) {
          anchorClasses.push('highlight')
        }
        if (highlightedExpressionArk && highlightedExpressionArk === group.anchor.ark) {
          anchorClasses.push('highlight')
        }
        if (highlightedWorkArk && anchorMatchesHighlight) anchorClasses.push('filter-match')

        return (
          <div key={group.anchor.id} className={groupClasses.join(' ')} data-anchor-expression-id={group.anchor.id}>
            <div
              className={anchorClasses.join(' ')}
              data-expression-id={group.anchor.id}
              data-expression-ark={group.anchor.ark ?? undefined}
              data-anchor-expression-id={group.anchor.id}
              onClick={() =>
                onSelectExpression({
                  expressionId: group.anchor.id,
                  expressionArk: group.anchor.ark,
                  workArk: group.anchor.workArk,
                  anchorId: group.anchor.id,
                })
              }
              onDoubleClick={event => {
                if (shouldIgnoreAnchorEvent(event)) return
                if (pendingClusterSourceId && pendingClusterSourceId === group.anchor.id) {
                  onCancelPendingCluster?.()
                  return
                }
                onOpenManifestations({
                  expressionId: group.anchor.id,
                  expressionArk: group.anchor.ark,
                  workArk: group.anchor.workArk,
                  anchorId: group.anchor.id,
                })
              }}
            >
              <ExpressionGroupLabel
                expression={group.anchor}
                isAnchor={group.anchor.workArk === cluster.anchorArk}
                manifestationCount={group.anchor.manifestations.length}
                workLinkCount={anchorWorkLinks}
                agentNames={anchorAgentNames}
                relationships={anchorRelationships}
                mediaKinds={anchorMediaKinds}
              />
            </div>
            {group.clustered.length > 0 ? (
              <div className="expression-items">
                {group.clustered.map(expr => {
                  const rowClasses = ['expression-item', 'entity-row', 'entity-row--expression']
                  if (!expr.accepted) rowClasses.push('unchecked')
                  if (pendingClusterSourceId && pendingClusterSourceId === expr.id) rowClasses.push('pending-cluster-source')
                  const exprAgentNames = getAgentNames(expr.id, expr.ark)
                  const exprMediaKinds = getMediaKinds(expr.id, expr.ark)
                  const { workLinkCount, relationships } = computeExpressionMetrics(expr.id, expr.ark)
                  const isSelectedExpression =
                    (selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === expr.id) ||
                    (selectedEntity?.entityType === 'manifestation' && selectedEntity.expressionId === expr.id)
                  const isWorkSelection =
                    selectedEntity?.entityType === 'work' && selectedEntity.workArk === expr.workArk
                  const matchesHighlight = matchesFilter(expr.workArk, highlightedWorkArk)
                  if (isSelectedExpression) rowClasses.push('selected')
                  else if (isWorkSelection || (highlightedWorkArk && matchesHighlight)) rowClasses.push('highlight')
                  if (highlightedWorkArk && matchesHighlight) rowClasses.push('filter-match')
                  if (highlightedExpressionArk && highlightedExpressionArk === expr.ark) {
                    rowClasses.push('highlight')
                  }

                  return (
                    <div
                      key={expr.id}
                      className={rowClasses.join(' ')}
                      data-expression-id={expr.id}
                      data-expression-ark={expr.ark ?? undefined}
                      data-anchor-expression-id={group.anchor.id}
                      onClick={() =>
                        onSelectExpression({
                          expressionId: expr.id,
                          expressionArk: expr.ark,
                          workArk: expr.workArk,
                          anchorId: group.anchor.id,
                        })
                      }
                      onDoubleClick={event => {
                        if (shouldIgnoreExpressionEvent(event)) return
                        if (pendingClusterSourceId && pendingClusterSourceId === expr.id) {
                          onCancelPendingCluster?.()
                          return
                        }
                        onOpenManifestations({
                          expressionId: expr.id,
                          expressionArk: expr.ark,
                          workArk: expr.workArk,
                          anchorId: group.anchor.id,
                        })
                      }}
                    >
                      {expr.ark ? (
                        <input
                          type="checkbox"
                          checked={expr.accepted}
                          onChange={event =>
                            onToggleExpression({
                              anchorExpressionId: group.anchor.id,
                              expressionArk: expr.ark!,
                              accepted: event.target.checked,
                            })
                          }
                        />
                      ) : null}
                      <ExpressionGroupLabel
                        expression={expr}
                        isAnchor={false}
                        manifestationCount={expr.manifestations.length}
                        agentNames={exprAgentNames}
                        workLinkCount={workLinkCount}
                        relationships={relationships}
                        mediaKinds={exprMediaKinds}
                      />
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

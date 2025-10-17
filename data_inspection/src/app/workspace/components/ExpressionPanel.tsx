import { useMemo, type MouseEvent } from 'react'
import type { Cluster, ExpressionClusterItem, ExpressionItem, EntityBadgeSpec } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { EntityLabel, EntityPill, CountBadge, AgentBadge, RelationshipBadge } from '../../components/EntityLabel'
import { useRecordLookup } from '../../hooks/useRecordLookup'

type ExpressionPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabState
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
}

type ExpressionGroupLabelProps = {
  expression: ExpressionItem | ExpressionClusterItem
  isAnchor: boolean
  manifestationCount: number
  agentNames: string[]
  relationshipCount: number
}

export function ExpressionGroupLabel({
  expression,
  isAnchor,
  manifestationCount,
  agentNames,
  relationshipCount,
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
      <CountBadge kind="manifestations" count={manifestationCount} />
      {relationshipCount > 0 ? <RelationshipBadge count={relationshipCount} /> : null}
      {agentNames.length ? <AgentBadge names={agentNames} /> : null}
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
}: ExpressionPanelProps) {
  const { t } = useTranslation()
  const { getAgentNames, getGeneralRelationshipCount } = useRecordLookup()
  if (!cluster) return <em>{t('messages.noClusters')}</em>

  const highlightedWorkArk = state.highlightedWorkArk ?? null
  const highlightedExpressionArk = state.highlightedExpressionArk ?? null
  const selectedEntity = state.selectedEntity

  const independentExpressions = useMemo(() => cluster.independentExpressions, [cluster.independentExpressions])

  return (
    <div className="expression-groups">
      {cluster.expressionGroups.map(group => {
        const groupClasses = ['expression-group']
        if (state.activeExpressionAnchorId === group.anchor.id) groupClasses.push('active')

        const anchorClasses = ['expression-anchor', 'entity-row', 'entity-row--expression']
        const anchorAgentNames = getAgentNames(group.anchor.id, group.anchor.ark)
        const anchorRelationships = getGeneralRelationshipCount(group.anchor.id, group.anchor.ark)

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
                isAnchor
                manifestationCount={group.anchor.manifestations.length}
                agentNames={anchorAgentNames}
                relationshipCount={anchorRelationships}
              />
            </div>
            <div className="expression-items">
              {group.clustered.length === 0 ? (
                <div className="expression-empty">{t('labels.noClusteredExpressions')}</div>
              ) : (
                group.clustered.map(expr => {
                  const rowClasses = ['expression-item', 'entity-row', 'entity-row--expression']
                  if (!expr.accepted) rowClasses.push('unchecked')
                  const exprAgentNames = getAgentNames(expr.id, expr.ark)
                  const relationshipCount = getGeneralRelationshipCount(expr.id, expr.ark)
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
                        relationshipCount={relationshipCount}
                      />
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )
      })}

      {independentExpressions.length ? (
        <div className="expression-independent">
          <div className="expression-independent-header">{t('labels.independentExpressions')}</div>
          {independentExpressions.map(expr => {
            const rowClasses = ['expression-item', 'entity-row', 'entity-row--expression', 'independent']
            const agentNames = getAgentNames(expr.id, expr.ark)
            const relationships = getGeneralRelationshipCount(expr.id, expr.ark)
            const matchesHighlight = matchesFilter(expr.workArk, highlightedWorkArk)
            const isSelectedExpression =
              (selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === expr.id) ||
              (selectedEntity?.entityType === 'manifestation' && selectedEntity.expressionId === expr.id)
            const isWorkSelection =
              selectedEntity?.entityType === 'work' && selectedEntity.workArk === expr.workArk
            if (isSelectedExpression) rowClasses.push('selected')
            else if (isWorkSelection || (highlightedWorkArk && matchesHighlight)) rowClasses.push('highlight')
            if (highlightedWorkArk && matchesHighlight) rowClasses.push('filter-match')
            if (highlightedExpressionArk && highlightedExpressionArk === expr.ark) rowClasses.push('highlight')

            const badges: EntityBadgeSpec[] = [{ type: 'expression', text: expr.id, tooltip: expr.ark }]
            if (expr.workId) badges.push({ type: 'work', text: expr.workId, tooltip: expr.workArk })

            return (
              <div
                key={expr.id}
                className={rowClasses.join(' ')}
                data-expression-id={expr.id}
                data-expression-ark={expr.ark ?? undefined}
                onClick={() =>
                  onSelectExpression({
                    expressionId: expr.id,
                    expressionArk: expr.ark,
                    workArk: expr.workArk,
                  })
                }
                onDoubleClick={event => {
                  if (shouldIgnoreExpressionEvent(event)) return
                  onOpenManifestations({
                    expressionId: expr.id,
                    expressionArk: expr.ark,
                    workArk: expr.workArk,
                  })
                }}
              >
                <EntityLabel
                  title={expr.title || expr.id}
                  subtitle={t('entity.independentExpression')}
                  badges={badges}
                  counts={{ manifestations: expr.manifestations.length }}
                  agentNames={agentNames}
                  relationshipsCount={relationships}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

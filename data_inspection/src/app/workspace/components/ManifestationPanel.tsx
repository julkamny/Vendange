import { useCallback } from 'react'
import type {
  Cluster,
  ManifestationItem,
  ExpressionItem,
  ExpressionClusterItem,
  EntityBadgeSpec,
} from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { useRecordLookup } from '../../hooks/useRecordLookup'
import { EntityLabel } from '../../components/EntityLabel'
import { ExpressionGroupLabel } from './ExpressionPanel'
import { countExpressionWorkLinks, countManifestationExpressionLinks, manifestationTitleSegments } from '../../core/entities'
import { useBacklinks } from '../../hooks/useBacklinks'

type ManifestationPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabStateWorkspace
  onSelectManifestation: (payload: {
    manifestationId: string
    expressionId?: string
    expressionArk?: string
  }) => void
}

type ExpressionSectionKind = 'anchor' | 'clustered' | 'independent'
type ExpressionWithMeta = ExpressionItem | ExpressionClusterItem

export function ManifestationPanel({
  cluster,
  state,
  onSelectManifestation,
}: ManifestationPanelProps) {
  const { t } = useTranslation()
  const { getById, getByArk, getAgentNames, getGeneralRelationshipCount } = useRecordLookup()
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
      return { workLinkCount, relationships: { outgoing, incoming } }
    },
    [countExpressionWorkLinks, countIncomingRelationships, getGeneralRelationshipCount, resolveExpressionRecord],
  )
  const computeManifestationMetrics = useCallback(
    (manifestationId: string, manifestationArk?: string | null) => {
      const record = getById(manifestationId) ?? getByArk(manifestationArk)
      const expressionLinks = record ? countManifestationExpressionLinks(record) : 0
      const outgoing = getGeneralRelationshipCount(manifestationId, manifestationArk)
      const incoming = record ? countIncomingRelationships(record) : 0
      const segments = record ? manifestationTitleSegments(record) : undefined
      return {
        expressionLinks,
        relationships: { outgoing, incoming },
        segments,
      }
    },
    [countIncomingRelationships, countManifestationExpressionLinks, getByArk, getById, getGeneralRelationshipCount],
  )
  if (!cluster) return <em>{t('messages.noClusters')}</em>
  const highlightedExpressionArk = state.highlightedExpressionArk ?? null
  const selectedEntity = state.selectedEntity

  const renderManifestationRow = (
    expression: ExpressionWithMeta,
    anchorExpressionId: string | null,
    manifestation: ManifestationItem,
  ) => {
    const rowClasses = ['manifestation-item', 'entity-row', 'entity-row--manifestation']
    const isSelectedManifestation =
      selectedEntity?.entityType === 'manifestation' && selectedEntity.id === manifestation.id
    const isExpressionSelection =
      selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === expression.id
    const isWorkSelection =
      selectedEntity?.entityType === 'work' && selectedEntity.workArk === expression.workArk
    const matchesExpressionHighlight =
      highlightedExpressionArk && highlightedExpressionArk === manifestation.expressionArk
    if (isSelectedManifestation) rowClasses.push('selected')
    else if (isExpressionSelection || isWorkSelection || matchesExpressionHighlight) {
      rowClasses.push('highlight')
    }
    if (manifestation.expressionArk !== manifestation.originalExpressionArk) {
      rowClasses.push('changed')
    }
    const badges: EntityBadgeSpec[] = [
      { type: 'manifestation', text: manifestation.id, tooltip: manifestation.ark },
    ]
    if (expression.id) {
      badges.push({ type: 'expression', text: expression.id, tooltip: expression.ark })
    }
    const agentNames = getAgentNames(manifestation.id, manifestation.ark)
    const metrics = computeManifestationMetrics(manifestation.id, manifestation.ark)
    const agentBadgeNames = agentNames.length ? agentNames : undefined

    return (
      <div
        key={manifestation.id}
        className={rowClasses.join(' ')}
        data-manifestation-id={manifestation.id}
        data-expression-ark={manifestation.expressionArk}
        data-expression-id={expression.id}
        data-anchor-expression-id={anchorExpressionId ?? undefined}
      >
        <button
          type="button"
          className="manifestation-item__main"
          onClick={() =>
            onSelectManifestation({
              manifestationId: manifestation.id,
              expressionId: manifestation.expressionId,
              expressionArk: manifestation.expressionArk,
            })
          }
        >
          <EntityLabel
            title={manifestation.title || manifestation.id}
            badges={badges}
            counts={{ expressionLinks: metrics.expressionLinks }}
            agentNames={agentBadgeNames}
            relationships={metrics.relationships}
            titleSegments={metrics.segments}
          />
        </button>
      </div>
    )
  }

  const renderManifestationList = (
    expression: ExpressionWithMeta,
    anchorExpressionId: string | null,
  ) => {
    if (!expression.manifestations.length) {
      return <div className="manifestation-empty">{t('labels.noManifestations')}</div>
    }
    return (
      <div className="manifestation-list">
        {expression.manifestations.map(manifestation =>
          renderManifestationRow(expression, anchorExpressionId, manifestation),
        )}
      </div>
    )
  }

  const renderExpressionSection = (
    expression: ExpressionWithMeta,
    kind: ExpressionSectionKind,
    anchorExpressionId: string | null,
  ) => {
    const sectionClasses = ['manifestation-section']
    const isExpressionSelected =
      selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === expression.id
    const isManifestationSelected =
      selectedEntity?.entityType === 'manifestation' && selectedEntity.expressionId === expression.id
    const matchesExpressionHighlight =
      highlightedExpressionArk && highlightedExpressionArk === expression.ark
    if (isExpressionSelected || isManifestationSelected || matchesExpressionHighlight) {
      sectionClasses.push('highlight')
    }
    if (kind === 'clustered' && 'accepted' in expression && !expression.accepted) {
      sectionClasses.push('inactive')
    }
    const agentNames = getAgentNames(expression.id, expression.ark)
    const { workLinkCount, relationships } = computeExpressionMetrics(expression.id, expression.ark)
    const meta =
      kind === 'anchor'
        ? t('entity.anchorExpression')
        : kind === 'clustered'
          ? t('entity.clusteredExpression')
          : t('entity.independentExpression')

    return (
      <div
        key={`${anchorExpressionId ?? 'independent'}:${expression.id}`}
        className={sectionClasses.join(' ')}
        data-expression-id={expression.id}
        data-expression-ark={expression.ark}
      >
        <div className="manifestation-section__header">
          <ExpressionGroupLabel
            expression={expression}
            isAnchor={kind === 'anchor'}
            manifestationCount={expression.manifestations.length}
            agentNames={agentNames}
            workLinkCount={workLinkCount}
            relationships={relationships}
          />
          <span className="manifestation-section__meta">{meta}</span>
        </div>
        {renderManifestationList(expression, anchorExpressionId)}
      </div>
    )
  }

  return (
    <div className="manifestation-panel">
      {cluster.expressionGroups.map(group => (
        <section key={group.anchor.id} className="manifestation-group">
          {renderExpressionSection(group.anchor, 'anchor', group.anchor.id)}
          {group.clustered.map(expr => renderExpressionSection(expr, 'clustered', group.anchor.id))}
        </section>
      ))}
      {cluster.independentExpressions.length > 0 && (
        <section className="manifestation-group manifestation-group--independent">
          <header className="manifestation-group__header">{t('labels.independentExpressions')}</header>
          {cluster.independentExpressions.map(expr =>
            renderExpressionSection(expr, 'independent', null),
          )}
        </section>
      )}
    </div>
  )
}

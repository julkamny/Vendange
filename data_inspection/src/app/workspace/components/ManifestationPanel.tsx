import type { WorkClusterDto, ExpressionItemViewDto, ExpressionClusterItemViewDto, ManifestationItemViewDto, EntityBadgeSpec } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { EntityLabel } from '../../components/EntityLabel'
import { ExpressionGroupLabel } from './ExpressionPanel'

type SummaryLike = { mediaKinds?: MediaKind[]; media_kinds?: MediaKind[]; counts?: { expressions?: number; manifestations?: number }; relationships?: { outgoing: number; incoming: number } }

const pickMediaKinds = (summary?: SummaryLike | null) => summary?.mediaKinds ?? summary?.media_kinds

type ManifestationPanelProps = {
  cluster: WorkClusterDto | null
  state: WorkspaceTabStateWorkspace
  pendingManifestationId?: string | null
  onSelectManifestation: (payload: {
    manifestationId: string
    expressionId?: string
    expressionArk?: string
  }) => void
}

type ExpressionSectionKind = 'anchor' | 'clustered' | 'independent'
type ExpressionWithMeta = ExpressionItemViewDto | ExpressionClusterItemViewDto

export function ManifestationPanel({
  cluster,
  state,
  pendingManifestationId,
  onSelectManifestation,
}: ManifestationPanelProps) {
  const { t } = useTranslation()
  if (!cluster) return <em>{t('messages.noClusters')}</em>
  const expressionGroups = cluster.expression_groups ?? []
  const independentExpressions = cluster.independent_expressions ?? []
  const highlightedExpressionArk = state.highlightedExpressionArk ?? null
  const selectedEntity = state.selectedEntity

  const renderManifestationRow = (
    expression: ExpressionWithMeta,
    anchorExpressionId: string | null,
    manifestation: ManifestationItemViewDto,
  ) => {
    const rowClasses = ['manifestation-item', 'entity-row', 'entity-row--manifestation']
    const isSelectedManifestation =
      selectedEntity?.entityType === 'manifestation' && selectedEntity.id === manifestation.id
    const isExpressionSelection =
      selectedEntity?.entityType === 'expression' && selectedEntity.expressionId === expression.id
    const isWorkSelection =
      selectedEntity?.entityType === 'work' && selectedEntity.workArk === expression.work_ark
    const matchesExpressionHighlight =
      highlightedExpressionArk && highlightedExpressionArk === manifestation.expression_ark
    if (pendingManifestationId && pendingManifestationId === manifestation.id) {
      rowClasses.push('pending-cluster-source')
    }
    if (isSelectedManifestation) rowClasses.push('selected')
    else if (isExpressionSelection || isWorkSelection || matchesExpressionHighlight) {
      rowClasses.push('highlight')
    }
    if (manifestation.expression_ark !== manifestation.original_expression_ark) {
      rowClasses.push('changed')
    }
    const badges: EntityBadgeSpec[] = [
      { type: 'manifestation', text: manifestation.id, tooltip: manifestation.ark },
    ]
    if (expression.id) {
      badges.push({ type: 'expression', text: expression.id, tooltip: expression.ark })
    }
    const mediaKinds = pickMediaKinds(manifestation.summary)
    const relationships = manifestation.summary?.relationships ?? { outgoing: 0, incoming: 0 }
    const expressionLinks = manifestation.summary?.counts?.expressions ?? 0

    return (
      <div
        key={manifestation.id}
        className={rowClasses.join(' ')}
        data-manifestation-id={manifestation.id}
        data-expression-ark={manifestation.expression_ark ?? undefined}
        data-expression-id={expression.id}
        data-anchor-expression-id={anchorExpressionId ?? undefined}
      >
        <button
          type="button"
          className="manifestation-item__main"
            onClick={() =>
              onSelectManifestation({
                manifestationId: manifestation.id,
                expressionId: manifestation.expression_id ?? undefined,
                expressionArk: manifestation.expression_ark ?? undefined,
              })
            }
          >
          <EntityLabel
            title={manifestation.title || manifestation.id}
            badges={badges}
            counts={{ expressionLinks }}
            agentNames={undefined}
            relationships={relationships}
            titleSegments={manifestation.title_segments ?? undefined}
            mediaKinds={mediaKinds}
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
    const agentNames: string[] = []
    const mediaKinds = pickMediaKinds(expression.summary)
    const relationships = expression.summary?.relationships ?? { outgoing: 0, incoming: 0 }
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
            relationships={relationships}
            mediaKinds={mediaKinds}
          />
          <span className="manifestation-section__meta">{meta}</span>
        </div>
        {renderManifestationList(expression, anchorExpressionId)}
      </div>
    )
  }

  return (
    <div className="manifestation-panel">
      {expressionGroups.map(group => (
        <section key={group.anchor.id} className="manifestation-group">
          {renderExpressionSection(group.anchor, 'anchor', group.anchor.id)}
          {group.clustered.map(expr => renderExpressionSection(expr, 'clustered', group.anchor.id))}
        </section>
      ))}
      {independentExpressions.length > 0 && (
        <section className="manifestation-group manifestation-group--independent">
          <header className="manifestation-group__header">{t('labels.independentExpressions')}</header>
          {independentExpressions.map(expr =>
            renderExpressionSection(expr, 'independent', null),
          )}
        </section>
      )}
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import type {
  Cluster,
  ManifestationItem,
  ExpressionItem,
  ExpressionClusterItem,
  EntityBadgeSpec,
} from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'
import { useRecordLookup } from '../../hooks/useRecordLookup'
import { EntityLabel } from '../../components/EntityLabel'
import { ExpressionGroupLabel } from './ExpressionPanel'
import { useAppData } from '../../providers/AppDataContext'

type ManifestationPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabState
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
  const { getAgentNames, getGeneralRelationshipCount, getByArk } = useRecordLookup()
  const { addExpressionToCluster } = useAppData()
  const [activeManifestAdd, setActiveManifestAdd] = useState<{
    anchorExpressionId: string
    manifestationId: string
  } | null>(null)
  const [manifestArkInput, setManifestArkInput] = useState('')
  const [manifestKeepLink, setManifestKeepLink] = useState(false)
  const [manifestError, setManifestError] = useState<string | null>(null)
  if (!cluster) return <em>{t('messages.noClusters')}</em>
  const highlightedExpressionArk = state.highlightedExpressionArk ?? null
  const selectedEntity = state.selectedEntity

  const renderManifestationRow = (
    expression: ExpressionWithMeta,
    anchorExpressionId: string | null,
    manifestation: ManifestationItem,
    sectionKind: ExpressionSectionKind,
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
    const relationships = getGeneralRelationshipCount(manifestation.id, manifestation.ark)

    return (
      <div
        key={manifestation.id}
        className={rowClasses.join(' ')}
        data-manifestation-id={manifestation.id}
        data-expression-ark={manifestation.expressionArk}
        data-expression-id={expression.id}
        data-anchor-expression-id={anchorExpressionId ?? undefined}
      >
        {(sectionKind === 'anchor' || sectionKind === 'independent') && anchorExpressionId ? (
          <div className="manifestation-tools">
            <button
              type="button"
              className="manifestation-add-button"
              onClick={() => {
                if (
                  activeManifestAdd &&
                  activeManifestAdd.anchorExpressionId === anchorExpressionId &&
                  activeManifestAdd.manifestationId === manifestation.id
                ) {
                  setActiveManifestAdd(null)
                  setManifestArkInput('')
                  setManifestKeepLink(false)
                  setManifestError(null)
                } else {
                  setActiveManifestAdd({
                    anchorExpressionId,
                    manifestationId: manifestation.id,
                  })
                  setManifestArkInput('')
                  setManifestKeepLink(false)
                  setManifestError(null)
                }
              }}
              aria-expanded={
                !!(
                  activeManifestAdd &&
                  activeManifestAdd.anchorExpressionId === anchorExpressionId &&
                  activeManifestAdd.manifestationId === manifestation.id
                )
              }
              aria-label={t('labels.addExpressionFromManifestation', {
                defaultValue: 'Link an expression using this manifestation',
              })}
            >
              +
            </button>
            {activeManifestAdd &&
            activeManifestAdd.anchorExpressionId === anchorExpressionId &&
            activeManifestAdd.manifestationId === manifestation.id ? (
              <form
                className="manifestation-add-form"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  const ark = manifestArkInput.trim()
                  if (!ark) {
                    setManifestError(
                      t('messages.expressionArkRequired', {
                        defaultValue: 'Enter an expression ARK.',
                      }),
                    )
                    return
                  }
                  const record = getByArk(ark)
                  if (!record || record.typeNorm !== 'expression') {
                    setManifestError(
                      t('messages.expressionArkNotFound', {
                        defaultValue: 'No expression was found for this ARK.',
                      }),
                    )
                    return
                  }
                  addExpressionToCluster({
                    clusterId: cluster.anchorId,
                    anchorExpressionId,
                    expressionArk: ark,
                    allowExternal: true,
                    manifestation: { id: manifestation.id, keepOriginalLink: manifestKeepLink },
                  })
                  setActiveManifestAdd(null)
                  setManifestArkInput('')
                  setManifestKeepLink(false)
                  setManifestError(null)
                }}
              >
                <input
                  type="text"
                  value={manifestArkInput}
                  onChange={event => setManifestArkInput(event.target.value)}
                  placeholder={t('labels.expressionArkPlaceholder', { defaultValue: 'ark:/...' })}
                />
                <label className="manifestation-keep-link">
                  <input
                    type="checkbox"
                    checked={manifestKeepLink}
                    onChange={event => setManifestKeepLink(event.target.checked)}
                  />
                  <span>{t('labels.keepExistingLink', { defaultValue: 'Keep current parent link' })}</span>
                </label>
                <button type="submit">{t('buttons.add', { defaultValue: 'Add' })}</button>
                <button
                  type="button"
                  className="manifestation-add-cancel"
                  onClick={() => {
                    setActiveManifestAdd(null)
                    setManifestArkInput('')
                    setManifestKeepLink(false)
                    setManifestError(null)
                  }}
                  aria-label={t('buttons.cancel', { defaultValue: 'Cancel' })}
                >
                  ×
                </button>
                {manifestError ? <div className="form-error">{manifestError}</div> : null}
              </form>
            ) : null}
          </div>
        ) : null}
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
            agentNames={agentNames}
            relationshipsCount={relationships}
          />
        </button>
      </div>
    )
  }

  const renderManifestationList = (
    expression: ExpressionWithMeta,
    anchorExpressionId: string | null,
    sectionKind: ExpressionSectionKind,
  ) => {
    if (!expression.manifestations.length) {
      return <div className="manifestation-empty">{t('labels.noManifestations')}</div>
    }
    return (
      <div className="manifestation-list">
        {expression.manifestations.map(manifestation =>
          renderManifestationRow(expression, anchorExpressionId, manifestation, sectionKind),
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
            relationshipCount={getGeneralRelationshipCount(expression.id, expression.ark)}
          />
          <span className="manifestation-section__meta">{meta}</span>
        </div>
        {renderManifestationList(expression, anchorExpressionId, kind)}
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
            renderExpressionSection(expr, 'independent', expr.id),
          )}
        </section>
      )}
    </div>
  )
}
